/**
 * Characterization tests for LiveKitTransport's lifecycle and connection contract.
 *
 * livekit-client's Room drives real WebRTC + device access, none of which is
 * available (or desirable) under happy-dom. We mock the module with a
 * controllable fake Room so the tests assert behavior at the abstract Transport
 * boundary — state transitions, callback wiring, auth handling, device
 * enumeration, and message framing — exactly as the moq spec does for the
 * @moq/* stack. Event names/enum values are internal to the mock: the transport
 * reads them from the same module, so only self-consistency matters.
 */

import { TransportStartError } from "@pipecat-ai/client-js";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  test,
  vi,
} from "vitest";

// ---- livekit-client mock ---------------------------------------------------
// makeLocalTrack is shared between the mock factory below and the test body
// (to fabricate pre-warmed tracks directly). vi.mock() factories are hoisted
// above all imports/top-level code, so a normal module-scope helper wouldn't
// be initialized yet when the factory runs — vi.hoisted() is what lets both
// sides share it without smuggling it through the mocked module's own
// exports (which would then have to type-check against the real
// livekit-client .d.ts, which obviously has no such export).
const { makeLocalTrack } = vi.hoisted(() => {
  const freshRawTrack = (track: Record<string, unknown>) =>
    ({
      getSettings: () => ({ deviceId: track.__deviceId }),
    }) as unknown as MediaStreamTrack;

  // Fake pre-warmed local tracks returned by createLocalAudioTrack/
  // createLocalVideoTrack, controllable per-test via mockResolvedValueOnce /
  // mockRejectedValueOnce. mute()/unmute()/restartTrack() mirror the real
  // LocalTrack API surface the transport now drives directly.
  const makeLocalTrack = (deviceId: string, kind: string = "audio") => {
    const track: Record<string, unknown> = {
      kind,
      mediaStreamTrack: {
        getSettings: () => ({ deviceId: track.__deviceId }),
      } as unknown as MediaStreamTrack,
      isMuted: false,
      __deviceId: deviceId,
      stop: vi.fn(),
      // Real LocalTrack.mute()/unmute() both no-op if already in that state
      // (see livekit-client's own muteLock-guarded early return) — mirror
      // that so a redundant call doesn't spuriously swap the raw track below.
      mute: vi.fn(async function (this: Record<string, unknown>) {
        if (this.isMuted) return;
        this.isMuted = true;
      }),
      // Real LocalAudioTrack.unmute() doesn't restart (same raw track
      // persists); real LocalVideoTrack.unmute() always calls restart()
      // internally, swapping in a fresh raw track. Mirror that distinction so
      // tests can observe onTrackStarted firing with the right object.
      unmute: vi.fn(async function (this: Record<string, unknown>) {
        if (!this.isMuted) return;
        this.isMuted = false;
        if (this.kind === "video") this.mediaStreamTrack = freshRawTrack(track);
      }),
      // restartTrack() always stops the old raw track and acquires a new one
      // from getUserMedia — even when it lands on the same device.
      restartTrack: vi.fn(async function (
        this: Record<string, unknown>,
        opts?: { deviceId?: string | { exact?: string; ideal?: string } }
      ) {
        if (opts?.deviceId) {
          this.__deviceId =
            typeof opts.deviceId === "string"
              ? opts.deviceId
              : (opts.deviceId.exact ?? opts.deviceId.ideal);
        }
        this.mediaStreamTrack = freshRawTrack(track);
      }),
    };
    return track;
  };

  return { makeLocalTrack };
});

vi.mock("livekit-client", () => {
  const RoomEvent = {
    DataReceived: "dataReceived",
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    Disconnected: "disconnected",
    LocalTrackPublished: "localTrackPublished",
    LocalTrackUnpublished: "localTrackUnpublished",
    MediaDevicesError: "mediaDevicesError",
  };

  const Track = {
    Kind: {
      Audio: "audio",
      Video: "video",
    },
    Source: {
      Microphone: "microphone",
      Camera: "camera",
      ScreenShare: "screen_share",
      ScreenShareAudio: "screen_share_audio",
    },
  };

  class LocalParticipant {
    identity = "local-user";
    name = "Local User";
    isScreenShareEnabled = false;
    lastMicrophoneError: Error | undefined = undefined;
    lastCameraError: Error | undefined = undefined;
    setMicrophoneEnabled = vi.fn(async (_e: boolean) => {});
    setCameraEnabled = vi.fn(async (_e: boolean) => {});
    setScreenShareEnabled = vi.fn(async (_e: boolean) => {});
    publishData = vi.fn();
    publishTrack = vi.fn(async (_t: unknown) => {});
    waitUntilActive = vi.fn(async () => {});
    getTrackPublication = vi.fn((_s: string) => undefined as unknown);
  }

  class RemoteParticipant {}

  const createLocalAudioTrack = vi.fn(async () =>
    makeLocalTrack("mic-1", "audio")
  );
  const createLocalVideoTrack = vi.fn(async () =>
    makeLocalTrack("cam-1", "video")
  );
  // createLocalTracks({audio: true, video: true}) — the combined-permission-
  // prompt path. Defaults to acquiring both; tests can override per-call to
  // simulate the all-or-nothing failure that triggers the individual fallback.
  const createLocalTracks = vi.fn(async () => [
    makeLocalTrack("mic-1", "audio"),
    makeLocalTrack("cam-1", "video"),
  ]);

  // Mirrors livekit-client's MediaDeviceFailure enum + getFailure() classifier
  // so the transport (which reads both from this same mocked module) stays
  // self-consistent under test.
  const MediaDeviceFailure = {
    PermissionDenied: "PermissionDenied",
    NotFound: "NotFound",
    DeviceInUse: "DeviceInUse",
    Other: "Other",
    getFailure(error: unknown): string | undefined {
      if (error && typeof error === "object" && "name" in error) {
        const name = (error as { name: string }).name;
        if (name === "NotAllowedError" || name === "PermissionDeniedError")
          return "PermissionDenied";
        if (name === "NotFoundError" || name === "DevicesNotFoundError")
          return "NotFound";
        if (name === "NotReadableError" || name === "TrackStartError")
          return "DeviceInUse";
        return "Other";
      }
      return undefined;
    },
  };

  // Mirrors livekit-client's ConnectionState — the transport gates
  // createLocalAudioTrack-vs-setMicrophoneEnabled on this, not on Pipecat's
  // own TransportState.
  const ConnectionState = {
    Disconnected: "disconnected",
    Connecting: "connecting",
    Connected: "connected",
    Reconnecting: "reconnecting",
    SignalReconnecting: "signal-reconnecting",
  };

  class Room {
    options: unknown;
    state: string = ConnectionState.Disconnected;
    localParticipant = new LocalParticipant();
    remoteParticipants = new Map<string, unknown>();
    connect = vi.fn(async (_u: string, _t: string, _o?: unknown) => {
      this.state = ConnectionState.Connected;
    });
    // Mirrors livekit-client's real Room.disconnect(): handleDisconnect()
    // stops/unpublishes tracks and emits RoomEvent.Disconnected synchronously,
    // all before disconnect()'s own promise resolves — not after.
    disconnect = vi.fn(async () => {
      if (this.state === ConnectionState.Disconnected) return;
      this.state = ConnectionState.Disconnected;
      this.emit(RoomEvent.Disconnected);
    });
    switchActiveDevice = vi.fn(async (_k: string, _id: string) => {});
    private _handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    constructor(options?: unknown) {
      this.options = options;
    }
    on(event: string, cb: (...a: unknown[]) => void) {
      (this._handlers[event] ||= []).push(cb);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      (this._handlers[event] || []).forEach((h) => h(...args));
    }
  }

  return {
    Room,
    RoomEvent,
    Track,
    ConnectionState,
    LocalParticipant,
    RemoteParticipant,
    MediaDeviceFailure,
    createLocalAudioTrack,
    createLocalVideoTrack,
    createLocalTracks,
  };
});

import { LiveKitTransport } from "@pipecat-ai/livekit-transport";
// Values come from the mock above; only self-consistency with the source matters.
import {
  createLocalAudioTrack,
  createLocalTracks,
  createLocalVideoTrack,
  RoomEvent,
  Track,
} from "livekit-client";

import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

// ---- navigator.mediaDevices stub -------------------------------------------
const DEFAULT_DEVICES = [
  { kind: "audioinput", deviceId: "mic-1", label: "Mic 1", groupId: "g1" },
  { kind: "audioinput", deviceId: "mic-2", label: "Mic 2", groupId: "g1" },
  { kind: "videoinput", deviceId: "cam-1", label: "Cam 1", groupId: "g2" },
  { kind: "audiooutput", deviceId: "spk-1", label: "Speaker 1", groupId: "g3" },
] as MediaDeviceInfo[];

interface MediaDevicesStub {
  enumerateDevices: Mock;
  addEventListener: Mock;
  removeEventListener: Mock;
}

function stubMediaDevices(
  devices: MediaDeviceInfo[] = DEFAULT_DEVICES
): MediaDevicesStub {
  const stub: MediaDevicesStub = {
    enumerateDevices: vi.fn(async () => devices),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: stub,
  });
  return stub;
}

// ---- internal fake-room accessor -------------------------------------------
interface FakeRoom {
  state: string;
  localParticipant: {
    isScreenShareEnabled: boolean;
    lastMicrophoneError: Error | undefined;
    lastCameraError: Error | undefined;
    setMicrophoneEnabled: Mock;
    setCameraEnabled: Mock;
    setScreenShareEnabled: Mock;
    publishData: Mock;
    publishTrack: Mock;
    waitUntilActive: Mock;
    getTrackPublication: Mock;
  };
  remoteParticipants: Map<string, unknown>;
  connect: Mock;
  disconnect: Mock;
  switchActiveDevice: Mock;
  emit: (event: string, ...args: unknown[]) => void;
}

const roomOf = (t: LiveKitTransport): FakeRoom =>
  (t as unknown as { _room: FakeRoom })._room;

interface FakeLocalTrack {
  mediaStreamTrack: MediaStreamTrack;
  isMuted: boolean;
  __deviceId: string;
  stop: Mock;
  mute: Mock;
  unmute: Mock;
  restartTrack: Mock;
}

const localAudioTrackOf = (t: LiveKitTransport): FakeLocalTrack | undefined =>
  (t as unknown as { _localAudioTrack?: FakeLocalTrack })._localAudioTrack;
const localVideoTrackOf = (t: LiveKitTransport): FakeLocalTrack | undefined =>
  (t as unknown as { _localVideoTrack?: FakeLocalTrack })._localVideoTrack;

// _connect / _validateConnectionParams take the non-exported LiveKitConnectParams;
// cast loose test objects through this helper to stay readable.
const connect = (t: LiveKitTransport, params: Record<string, unknown>) =>
  t._connect(params as never);

// _handleDeviceChange is the private async body behind the devicechange
// listener; invoking it directly (rather than pulling the listener off the
// addEventListener mock and waiting out its internal microtask chain) keeps
// these tests focused on behavior instead of timing.
const triggerDeviceChange = (t: LiveKitTransport): Promise<void> =>
  (t as unknown as { _handleDeviceChange(): Promise<void> })._handleDeviceChange();

describe("LiveKitTransport — characterization", () => {
  let transport: LiveKitTransport;
  let mediaDevices: MediaDevicesStub;

  beforeEach(() => {
    mediaDevices = stubMediaDevices();
    transport = new LiveKitTransport();
    (createLocalAudioTrack as Mock)
      .mockReset()
      .mockImplementation(async () => makeLocalTrack("mic-1", "audio"));
    (createLocalVideoTrack as Mock)
      .mockReset()
      .mockImplementation(async () => makeLocalTrack("cam-1", "video"));
    (createLocalTracks as Mock).mockReset().mockImplementation(async () => [
      makeLocalTrack("mic-1", "audio"),
      makeLocalTrack("cam-1", "video"),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("lifecycle", () => {
    test("initial state after construction is 'disconnected'", () => {
      expect(transport.state).toBe("disconnected");
    });

    test("initialize() keeps state 'disconnected' and records no transitions", () => {
      // initialize() re-sets the same 'disconnected' sentinel the abstract
      // Transport already holds, so the state setter short-circuits and never
      // fires onTransportStateChanged.
      const { callbacks, recorder } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      expect(transport.state).toBe("disconnected");
      expect(recorder.states).toEqual([]);
    });

    test.each([
      [{ enableMic: true, enableCam: false }],
      [{ enableMic: false, enableCam: false }],
      [{ enableMic: true, enableCam: true }],
      [{ enableMic: false, enableCam: true }],
    ])(
      "initialize(%j) stores enable flags on isMicEnabled/isCamEnabled",
      (opts) => {
        const { callbacks } = buildSpyCallbacks();
        wireTransport(transport, callbacks, opts);

        expect(transport.isMicEnabled).toBe(opts.enableMic);
        expect(transport.isCamEnabled).toBe(opts.enableCam);
      }
    );

    test("initialize() attaches a devicechange listener", () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      expect(mediaDevices.addEventListener).toHaveBeenCalledWith(
        "devicechange",
        expect.any(Function)
      );
    });

    test("initDevices(): disconnected → initializing → initialized and enumerates devices", async () => {
      const { callbacks, recorder, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      await transport.initDevices();

      expect(transport.state).toBe("initialized");
      expect(recorder.states).toEqual(["initializing", "initialized"]);
      expect(mediaDevices.enumerateDevices).toHaveBeenCalled();
      expect(spies.onAvailableMicsUpdated).toHaveBeenLastCalledWith(
        expect.objectContaining({ length: 2 })
      );
      expect(spies.onAvailableCamsUpdated).toHaveBeenLastCalledWith(
        expect.objectContaining({ length: 1 })
      );
      expect(spies.onAvailableSpeakersUpdated).toHaveBeenLastCalledWith(
        expect.objectContaining({ length: 1 })
      );
      // Default options enable mic only.
      expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
      expect(createLocalVideoTrack).not.toHaveBeenCalled();
      expect(spies.onMicUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "mic-1" })
      );
      expect(spies.onTrackStarted).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ local: true })
      );
      expect(spies.onDeviceError).not.toHaveBeenCalled();
      // Regression: selectedSpeaker used to stay {} until updateSpeaker() was
      // called explicitly — nothing initialized it from the device list.
      expect(spies.onSpeakerUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "spk-1" })
      );
      expect(
        (transport.selectedSpeaker as MediaDeviceInfo).deviceId
      ).toBe("spk-1");
    });

    test("initDevices() selects the virtual 'default' speaker over other candidates when present", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      mediaDevices.enumerateDevices.mockResolvedValue([
        ...DEFAULT_DEVICES,
        {
          kind: "audiooutput",
          deviceId: "default",
          label: "Default - Speaker 1",
          groupId: "g3",
        },
      ]);

      await transport.initDevices();

      expect(spies.onSpeakerUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "default" })
      );
    });

    test("initDevices() requests mic+cam together via createLocalTracks() when both are enabled", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: true, enableCam: true });

      await transport.initDevices();

      expect(createLocalTracks).toHaveBeenCalledTimes(1);
      expect(createLocalTracks).toHaveBeenCalledWith({
        audio: { deviceId: "default" },
        video: { deviceId: "default" },
      });
      expect(createLocalAudioTrack).not.toHaveBeenCalled();
      expect(createLocalVideoTrack).not.toHaveBeenCalled();
      expect(spies.onMicUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "mic-1" })
      );
      expect(spies.onCamUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "cam-1" })
      );
    });

    test("if the combined createLocalTracks() request fails, initDevices() falls back to acquiring each independently", async () => {
      (createLocalTracks as Mock).mockRejectedValueOnce(
        Object.assign(new Error("cam busy"), { name: "NotReadableError" })
      );
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: true, enableCam: true });

      await transport.initDevices();

      expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
      expect(createLocalVideoTrack).toHaveBeenCalledTimes(1);
      expect(spies.onMicUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "mic-1" })
      );
      expect(spies.onCamUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "cam-1" })
      );
    });

    test("initDevices() reports a mic acquisition failure through onDeviceError but still resolves", async () => {
      (createLocalAudioTrack as Mock).mockRejectedValueOnce(
        Object.assign(new Error("Permission denied"), {
          name: "NotAllowedError",
        })
      );
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      await transport.initDevices();

      expect(transport.state).toBe("initialized");
      expect(spies.onDeviceError).toHaveBeenCalledTimes(1);
      expect(spies.onDeviceError).toHaveBeenCalledWith(
        expect.objectContaining({ devices: ["mic"], type: "permissions" })
      );
      expect(spies.onMicUpdated).not.toHaveBeenCalled();
    });

    test("initDevices() reports a cam acquisition failure through onDeviceError but still resolves", async () => {
      (createLocalVideoTrack as Mock).mockRejectedValueOnce(
        Object.assign(new Error("No camera found"), {
          name: "NotFoundError",
        })
      );
      const { callbacks, spies } = buildSpyCallbacks();
      // mic disabled so this exercises the single-device (not combined
      // createLocalTracks) acquisition path.
      wireTransport(transport, callbacks, { enableMic: false, enableCam: true });

      await transport.initDevices();

      expect(transport.state).toBe("initialized");
      expect(spies.onDeviceError).toHaveBeenCalledTimes(1);
      expect(spies.onDeviceError).toHaveBeenCalledWith(
        expect.objectContaining({ devices: ["cam"], type: "not-found" })
      );
      expect(spies.onCamUpdated).not.toHaveBeenCalled();
    });

    // "ready" means the bot can hear/see us and we can hear/see it — not just
    // "connected to the room". So sendReadyMessage() only resolves right away
    // if the bot's media is already subscribed; otherwise it waits for
    // RoomEvent.TrackSubscribed. Mirrors the daily-transport contract.
    test("sendReadyMessage() resolves immediately when the bot's media is already subscribed", async () => {
      const { callbacks, recorder } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      recorder.states.length = 0;

      const bot = {
        identity: "bot-1",
        name: "Bot",
        getTrackPublication: (s: string) =>
          s === Track.Source.Microphone
            ? { track: { mediaStreamTrack: {} } }
            : undefined,
      };
      roomOf(transport).remoteParticipants.set("bot-1", bot);
      roomOf(transport).emit(RoomEvent.ParticipantConnected, bot); // sets _botId

      await transport.sendReadyMessage();

      expect(transport.state).toBe("ready");
      expect(recorder.states).toEqual(["ready"]);
      expect(
        roomOf(transport).localParticipant.publishData
      ).toHaveBeenCalledWith(expect.any(Uint8Array), { reliable: true });
    });

    test("sendReadyMessage() waits for a track to be subscribed before becoming ready", async () => {
      const { callbacks, recorder } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      recorder.states.length = 0;

      const bot = {
        identity: "bot-1",
        name: "Bot",
        getTrackPublication: () => undefined,
      };
      roomOf(transport).remoteParticipants.set("bot-1", bot);
      roomOf(transport).emit(RoomEvent.ParticipantConnected, bot);

      const readyPromise = transport.sendReadyMessage();
      await Promise.resolve();
      expect(transport.state).not.toBe("ready");
      expect(
        roomOf(transport).localParticipant.publishData
      ).not.toHaveBeenCalled();

      roomOf(transport).emit(
        RoomEvent.TrackSubscribed,
        { kind: "audio", mediaStreamTrack: {} },
        { source: Track.Source.Microphone },
        bot
      );
      await readyPromise;

      expect(transport.state).toBe("ready");
      expect(recorder.states).toEqual(["ready"]);
      expect(
        roomOf(transport).localParticipant.publishData
      ).toHaveBeenCalledWith(expect.any(Uint8Array), { reliable: true });
    });

    test("_disconnect(): disconnecting → disconnected, disconnects room, removes listener, fires onDisconnected", async () => {
      const { callbacks, recorder, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      recorder.states.length = 0;

      await transport._disconnect();

      expect(transport.state).toBe("disconnected");
      expect(recorder.states).toEqual(["disconnecting", "disconnected"]);
      expect(roomOf(transport).disconnect).toHaveBeenCalledTimes(1);
      expect(mediaDevices.removeEventListener).toHaveBeenCalledWith(
        "devicechange",
        expect.any(Function)
      );
      expect(spies.onDisconnected).toHaveBeenCalledTimes(1);
    });

    // Regression: livekit-client's real Room.disconnect() emits
    // RoomEvent.Disconnected synchronously, before its own promise resolves
    // — so handleRoomDisconnected() (via that event) used to run the full
    // teardown once, and then _disconnect()'s own unconditional teardown at
    // the end ran it a second time, firing onDisconnected twice per
    // disconnect. Exercise the case where the room actually was connected
    // (so the event genuinely fires) and confirm it's still exactly once.
    test("_disconnect() after an actual connection fires onDisconnected exactly once, not twice", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await connect(transport, { url: "wss://lk.example", token: "tok" });

      await transport._disconnect();

      expect(spies.onDisconnected).toHaveBeenCalledTimes(1);
    });

    test("_disconnect() stops a pre-warmed track that was never published (e.g. connect() never ran)", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();
      const track = localAudioTrackOf(transport)!;

      await transport._disconnect();

      expect(track.stop).toHaveBeenCalledTimes(1);
    });

    test("_disconnect() reports mic/cam as stopped and flips isMicEnabled/isCamEnabled to false", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: true, enableCam: true });
      await transport.initDevices();
      const micTrack = localAudioTrackOf(transport)!;
      const camTrack = localVideoTrackOf(transport)!;

      await transport._disconnect();

      expect(spies.onTrackStopped).toHaveBeenCalledWith(
        micTrack.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
      expect(spies.onTrackStopped).toHaveBeenCalledWith(
        camTrack.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
      expect(transport.isMicEnabled).toBe(false);
      expect(transport.isCamEnabled).toBe(false);
    });

    test("isMicEnabled/isCamEnabled already reflect false from inside disconnect's onTrackStopped callback", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: true, enableCam: true });
      await transport.initDevices();

      const seenMic: boolean[] = [];
      const seenCam: boolean[] = [];
      const micTrack = localAudioTrackOf(transport)!;
      const camTrack = localVideoTrackOf(transport)!;
      spies.onTrackStopped.mockImplementation((track: MediaStreamTrack) => {
        if (track === micTrack.mediaStreamTrack) seenMic.push(transport.isMicEnabled);
        if (track === camTrack.mediaStreamTrack) seenCam.push(transport.isCamEnabled);
      });

      await transport._disconnect();

      expect(seenMic).toEqual([false]);
      expect(seenCam).toEqual([false]);
    });

    test("_disconnect() is a no-op for onTrackStopped when nothing was ever live (mic/cam disabled)", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, {
        enableMic: false,
        enableCam: false,
      });

      await transport._disconnect();

      expect(spies.onTrackStopped).not.toHaveBeenCalled();
      expect(transport.isMicEnabled).toBe(false);
      expect(transport.isCamEnabled).toBe(false);
    });
  });

  describe("connection", () => {
    test("_connect() with direct url+token connects and reaches 'connected'", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      await connect(transport, { url: "wss://lk.example", token: "tok" });

      expect(roomOf(transport).connect).toHaveBeenCalledWith(
        "wss://lk.example",
        "tok",
        undefined
      );
      expect(transport.state).toBe("connected");
      expect(spies.onConnected).toHaveBeenCalledTimes(1);
    });

    test("_connect() publishes tracks pre-warmed by initDevices(), alongside room.connect()", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: true, enableCam: true });
      await transport.initDevices();
      const audioTrack = localAudioTrackOf(transport);
      const videoTrack = localVideoTrackOf(transport);

      await connect(transport, { url: "wss://lk.example", token: "tok" });

      expect(roomOf(transport).localParticipant.publishTrack).toHaveBeenCalledWith(
        audioTrack
      );
      expect(roomOf(transport).localParticipant.publishTrack).toHaveBeenCalledWith(
        videoTrack
      );
      expect(roomOf(transport).connect).toHaveBeenCalled();
    });

    test("_connect() publishes nothing when initDevices() was never called", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: true, enableCam: false });

      await connect(transport, { url: "wss://lk.example", token: "tok" });

      expect(
        roomOf(transport).localParticipant.publishTrack
      ).not.toHaveBeenCalled();
    });

    test("a publish failure alongside a successful room.connect() does not fail the connection — it's reported via onDeviceError instead", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: true });
      await transport.initDevices();
      roomOf(transport).localParticipant.publishTrack.mockRejectedValueOnce(
        new Error("publish rejected")
      );

      await connect(transport, { url: "wss://lk.example", token: "tok" });

      // The room still connected fine — losing one track shouldn't sink the
      // whole session.
      expect(transport.state).toBe("connected");
      expect(spies.onDeviceError).toHaveBeenCalledTimes(1);
      expect(spies.onDeviceError).toHaveBeenCalledWith(
        expect.objectContaining({ devices: ["mic"] })
      );
    });

    test("_connect() without url/token throws TransportStartError and enters 'error'", async () => {
      const { callbacks, recorder } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      await expect(connect(transport, {})).rejects.toThrow(
        "LiveKit connection requires 'url' and 'token'"
      );
      expect(transport.state).toBe("error");
      expect(recorder.states).toEqual(["error"]);
    });

    test("_connect() surfaces a room.connect() failure as TransportStartError + 'error' state", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      roomOf(transport).connect.mockRejectedValueOnce(new Error("ice failed"));

      await expect(
        connect(transport, { url: "wss://lk.example", token: "tok" })
      ).rejects.toBeInstanceOf(TransportStartError);
      expect(transport.state).toBe("error");
    });
  });

  describe("messaging", () => {
    test("sendMessage() before connect is a no-op (guarded, publishData not called)", () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      expect(() =>
        transport.sendMessage({
          id: "x",
          label: "rtvi-ai",
          type: "test",
          data: {},
        } as never)
      ).not.toThrow();
      expect(roomOf(transport).localParticipant.publishData).not.toHaveBeenCalled();
    });

    test("sendMessage() when connected publishes encoded bytes over the reliable data channel", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await connect(transport, { url: "wss://lk.example", token: "tok" });

      transport.sendMessage({
        id: "x",
        label: "rtvi-ai",
        type: "test",
        data: {},
      } as never);

      expect(roomOf(transport).localParticipant.publishData).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        { reliable: true }
      );
    });

    test("inbound DataReceived is decoded, parsed, and forwarded to the message handler", () => {
      const { callbacks } = buildSpyCallbacks();
      const { onMessage } = wireTransport(transport, callbacks);

      const payload = new TextEncoder().encode(
        JSON.stringify({ id: "1", label: "rtvi-ai", type: "server-message", data: {} })
      );
      roomOf(transport).emit(RoomEvent.DataReceived, payload);

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "server-message" })
      );
    });

    test("inbound DataReceived with invalid JSON is swallowed (no throw, handler not called)", () => {
      const { callbacks } = buildSpyCallbacks();
      const { onMessage } = wireTransport(transport, callbacks);

      const payload = new TextEncoder().encode("{ not valid json");
      expect(() =>
        roomOf(transport).emit(RoomEvent.DataReceived, payload)
      ).not.toThrow();
      expect(onMessage).not.toHaveBeenCalled();
    });

    test.each([
      ["missing label", { id: "1", type: "server-message", data: {} }],
      [
        "non-rtvi label",
        { id: "1", label: "not-rtvi", type: "server-message", data: {} },
      ],
    ])(
      "inbound DataReceived with %s is ignored (handler not called)",
      (_desc, message) => {
        const { callbacks } = buildSpyCallbacks();
        const { onMessage } = wireTransport(transport, callbacks);

        const payload = new TextEncoder().encode(JSON.stringify(message));
        roomOf(transport).emit(RoomEvent.DataReceived, payload);

        expect(onMessage).not.toHaveBeenCalled();
      }
    );
  });

  describe("device management", () => {
    test("getAllMics/getAllCams/getAllSpeakers filter enumerated devices by kind", async () => {
      expect(await transport.getAllMics()).toHaveLength(2);
      expect(await transport.getAllCams()).toHaveLength(1);
      expect(await transport.getAllSpeakers()).toHaveLength(1);
    });

    test("updateMic() restarts the owned track on the new device and fires onMicUpdated", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();
      const track = localAudioTrackOf(transport)!;

      await transport.updateMic("mic-2");

      expect(track.restartTrack).toHaveBeenCalledWith({ deviceId: { exact: "mic-2" } });
      expect(spies.onMicUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "mic-2" })
      );
    });

    test("updateMic() reports the device swap via onTrackStopped/onTrackStarted — restartTrack() always produces a new raw MediaStreamTrack", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();
      const track = localAudioTrackOf(transport)!;
      const oldRawTrack = track.mediaStreamTrack;
      spies.onTrackStarted.mockClear();

      await transport.updateMic("mic-2");

      // restartTrack() genuinely swaps the raw track — onTrackStopped gets
      // the old object, onTrackStarted the new (now-current) one.
      expect(spies.onTrackStopped).toHaveBeenCalledWith(
        oldRawTrack,
        expect.objectContaining({ local: true })
      );
      expect(track.mediaStreamTrack).not.toBe(oldRawTrack);
      expect(spies.onTrackStarted).toHaveBeenCalledWith(
        track.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
    });

    test("updateMic() does not report a swap while muted — no valid media on either side of it", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();
      const track = localAudioTrackOf(transport)!;
      await transport.enableMic(false);
      spies.onTrackStarted.mockClear();
      spies.onTrackStopped.mockClear();

      await transport.updateMic("mic-2");

      expect(track.restartTrack).toHaveBeenCalledWith({ deviceId: { exact: "mic-2" } });
      expect(spies.onTrackStopped).not.toHaveBeenCalled();
      expect(spies.onTrackStarted).not.toHaveBeenCalled();
    });

    test("updateMic() reports a restartTrack failure through onDeviceError", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();
      localAudioTrackOf(transport)!.restartTrack.mockRejectedValueOnce(
        new Error("boom")
      );

      await transport.updateMic("mic-2");

      expect(spies.onDeviceError).toHaveBeenCalledTimes(1);
      expect(spies.onMicUpdated).not.toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "mic-2" })
      );
    });

    test("updateMic() is a no-op when the mic was never enabled (no owned track to switch)", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: false });

      await transport.updateMic("mic-2");

      expect(createLocalAudioTrack).not.toHaveBeenCalled();
    });

    test("enableMic(false) then enableMic(true) mutes/unmutes the existing track in place", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();
      const track = localAudioTrackOf(transport)!;
      (createLocalAudioTrack as Mock).mockClear();

      await transport.enableMic(false);
      expect(track.mute).toHaveBeenCalledTimes(1);

      await transport.enableMic(true);
      expect(track.unmute).toHaveBeenCalledTimes(1);
      // Toggling reuses the existing track; it never re-acquires.
      expect(createLocalAudioTrack).not.toHaveBeenCalled();
    });

    test("isMicEnabled already reflects the new state from inside the onTrackStopped/onTrackStarted callback", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();

      const seenDuringStopped: boolean[] = [];
      spies.onTrackStopped.mockImplementation(() => {
        seenDuringStopped.push(transport.isMicEnabled);
      });
      await transport.enableMic(false);
      expect(seenDuringStopped).toEqual([false]);

      const seenDuringStarted: boolean[] = [];
      spies.onTrackStarted.mockImplementation(() => {
        seenDuringStarted.push(transport.isMicEnabled);
      });
      await transport.enableMic(true);
      expect(seenDuringStarted).toEqual([true]);
    });

    test("enableMic(true) with no existing track pre-warms one via createLocalAudioTrack() when not connected", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: false });

      await transport.enableMic(true);

      expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
      expect(spies.onMicUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "mic-1" })
      );
      expect(
        roomOf(transport).localParticipant.setMicrophoneEnabled
      ).not.toHaveBeenCalled();
    });

    test("a failed enableMic(true) leaves isMicEnabled reflecting reality, not the attempted state", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: false });
      (createLocalAudioTrack as Mock).mockRejectedValueOnce(
        new Error("permission denied")
      );

      await transport.enableMic(true);

      expect(transport.isMicEnabled).toBe(false);
    });

    test("a failed enableMic(false) leaves isMicEnabled reflecting reality, not the attempted state", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks); // default enableMic: true
      await transport.initDevices();
      localAudioTrackOf(transport)!.mute.mockRejectedValueOnce(
        new Error("boom")
      );

      await transport.enableMic(false);

      expect(transport.isMicEnabled).toBe(true);
    });

    test("enableMic(true) with no existing track uses setMicrophoneEnabled() once already connected", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: false });
      await connect(transport, { url: "wss://lk.example", token: "tok" });
      const publishedTrack = makeLocalTrack("mic-2");
      roomOf(transport).localParticipant.getTrackPublication = vi.fn(
        (s: string) =>
          s === Track.Source.Microphone ? { track: publishedTrack } : undefined
      );

      await transport.enableMic(true);

      expect(
        roomOf(transport).localParticipant.setMicrophoneEnabled
      ).toHaveBeenCalledWith(true);
      expect(createLocalAudioTrack).not.toHaveBeenCalled();
      expect(localAudioTrackOf(transport)).toBe(publishedTrack);
      expect(spies.onMicUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "mic-2" })
      );
    });

    test("enableMic(false)/(true) while already connected goes through setMicrophoneEnabled(), not a direct mute()/unmute() call", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices(); // acquires the track pre-connect
      await connect(transport, { url: "wss://lk.example", token: "tok" }); // publishes it
      const track = localAudioTrackOf(transport)!;
      // The real setMicrophoneEnabled() resolves to track.mute()/unmute()
      // internally when a publication already exists (that's the whole point
      // of this test); our bare mock doesn't simulate that side effect, so
      // apply it directly to make _syncSelectedMic()'s diff observable.
      roomOf(transport).localParticipant.setMicrophoneEnabled.mockImplementation(
        async (enable: boolean) => {
          track.isMuted = !enable;
        }
      );

      await transport.enableMic(false);
      expect(
        roomOf(transport).localParticipant.setMicrophoneEnabled
      ).toHaveBeenCalledWith(false);
      // We don't call mute() ourselves — setMicrophoneEnabled() already did
      // — but we still have to report the transition, since mute()/unmute()
      // never fire LocalTrackPublished/Unpublished.
      expect(track.mute).not.toHaveBeenCalled();
      expect(spies.onTrackStopped).toHaveBeenCalledWith(
        track.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );

      await transport.enableMic(true);
      expect(
        roomOf(transport).localParticipant.setMicrophoneEnabled
      ).toHaveBeenCalledWith(true);
      expect(track.unmute).not.toHaveBeenCalled();
      expect(spies.onTrackStarted).toHaveBeenCalledWith(
        track.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
    });

    test("enableCam(false)/(true) while already connected goes through setCameraEnabled() and still re-syncs the selected device on enable", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: false, enableCam: true });
      await transport.initDevices();
      await connect(transport, { url: "wss://lk.example", token: "tok" });
      const track = localVideoTrackOf(transport)!;
      spies.onCamUpdated.mockClear();
      // The real setCameraEnabled() resolves to track.mute()/unmute()
      // internally when a publication already exists — our bare mock doesn't
      // simulate that, so apply the equivalent state change directly
      // (without going through the mute()/unmute() spies themselves, since
      // this test asserts our own code doesn't separately call those).
      roomOf(transport).localParticipant.setCameraEnabled.mockImplementation(
        async (enable: boolean) => {
          track.isMuted = !enable;
          // LocalVideoTrack.unmute() always restarts internally, swapping in
          // a fresh raw track — mirror that so the re-sync below is real.
          if (enable) {
            track.mediaStreamTrack = {
              getSettings: () => ({ deviceId: track.__deviceId }),
            } as unknown as MediaStreamTrack;
          }
        }
      );

      await transport.enableCam(false);
      expect(
        roomOf(transport).localParticipant.setCameraEnabled
      ).toHaveBeenCalledWith(false);
      expect(track.mute).not.toHaveBeenCalled();
      expect(spies.onTrackStopped).toHaveBeenCalledWith(
        track.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );

      // Simulate the original device having disappeared while muted — the
      // restart-on-unmute above lands on a different one.
      mediaDevices.enumerateDevices.mockResolvedValue([
        ...DEFAULT_DEVICES,
        { kind: "videoinput", deviceId: "cam-2", label: "Cam 2", groupId: "g2" },
      ] as MediaDeviceInfo[]);
      track.__deviceId = "cam-2";

      await transport.enableCam(true);
      expect(
        roomOf(transport).localParticipant.setCameraEnabled
      ).toHaveBeenCalledWith(true);
      expect(spies.onCamUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "cam-2" })
      );
      expect(spies.onTrackStarted).toHaveBeenCalledWith(
        track.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
    });

    test("enableCam(false) stops the owned track outright (camera indicator turns off)", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: false, enableCam: true });
      await transport.initDevices();
      const track = localVideoTrackOf(transport)!;

      await transport.enableCam(false);

      // Mirrors livekit-client's own LocalVideoTrack.mute() semantics for
      // camera sources: stop the hardware, don't just flip .enabled.
      expect(track.mute).toHaveBeenCalledTimes(1);
    });

    test("enableCam(false)/(true) fire onTrackStopped/onTrackStarted, since mute()/unmute() swap the underlying MediaStreamTrack for camera sources", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: false, enableCam: true });
      await transport.initDevices();
      const track = localVideoTrackOf(transport)!;
      const trackBeforeMute = track.mediaStreamTrack;
      spies.onTrackStarted.mockClear();

      await transport.enableCam(false);
      expect(spies.onTrackStopped).toHaveBeenCalledWith(
        trackBeforeMute,
        expect.objectContaining({ local: true })
      );

      await transport.enableCam(true);
      expect(spies.onTrackStarted).toHaveBeenCalledWith(
        track.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
    });

    test("enableMic(false)/(true) fire onTrackStopped/onTrackStarted even though the same MediaStreamTrack persists throughout", async () => {
      // onTrackStarted/onTrackStopped signal media validity, not literal
      // object identity — a mute is exactly the transition callers need to
      // hear about, even with the same instance under the hood.
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();
      const track = localAudioTrackOf(transport)!;
      spies.onTrackStarted.mockClear();

      await transport.enableMic(false);
      expect(spies.onTrackStopped).toHaveBeenCalledWith(
        track.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );

      await transport.enableMic(true);
      expect(spies.onTrackStarted).toHaveBeenCalledWith(
        track.mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
    });

    test("a redundant enableMic(true) while already enabled does not re-fire onTrackStarted", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks); // default enableMic: true
      await transport.initDevices();
      spies.onTrackStarted.mockClear();

      await transport.enableMic(true);

      expect(spies.onTrackStarted).not.toHaveBeenCalled();
      expect(spies.onTrackStopped).not.toHaveBeenCalled();
    });

    test("a redundant enableCam(true) while already enabled does not re-fire onTrackStarted", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: false, enableCam: true });
      await transport.initDevices();
      spies.onTrackStarted.mockClear();

      await transport.enableCam(true);

      expect(spies.onTrackStarted).not.toHaveBeenCalled();
      expect(spies.onTrackStopped).not.toHaveBeenCalled();
    });

    test("_syncSelectedCam() doesn't re-fire onCamUpdated when re-synced to the same device", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: false, enableCam: true });
      await transport.initDevices(); // selects cam-1, fires onCamUpdated once
      spies.onCamUpdated.mockClear();
      const track = localVideoTrackOf(transport)!;

      // Calling the sync helper again for the *same* already-selected device
      // (e.g. from enableCam()'s unmute path, or a devicechange reselect that
      // lands back on the same device) should stay quiet.
      await (
        transport as unknown as {
          _syncSelectedCam(t: unknown): Promise<void>;
        }
      )._syncSelectedCam(track);

      expect(spies.onCamUpdated).not.toHaveBeenCalled();
    });

    test.each([
      ["audioinput", "NotAllowedError", ["mic"], "permissions"],
      ["videoinput", "NotFoundError", ["cam"], "not-found"],
      ["audioinput", "NotReadableError", ["mic"], "in-use"],
      ["audiooutput", "GremlinError", ["speaker"], "unknown"],
    ])(
      "MediaDevicesError(kind=%s, %s) classifies onDeviceError as (%j, %s)",
      (kind, errorName, devices, type) => {
        const { callbacks, spies } = buildSpyCallbacks();
        wireTransport(transport, callbacks);

        const error = Object.assign(new Error("device failure"), {
          name: errorName,
        });
        roomOf(transport).emit(RoomEvent.MediaDevicesError, error, kind);

        expect(spies.onDeviceError).toHaveBeenCalledTimes(1);
        expect(spies.onDeviceError).toHaveBeenCalledWith(
          expect.objectContaining({ devices, type })
        );
      }
    );

    test("MediaDevicesError without a kind falls back to both cam+mic", () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      roomOf(transport).emit(
        RoomEvent.MediaDevicesError,
        new Error("no kind reported")
      );

      expect(spies.onDeviceError).toHaveBeenCalledWith(
        expect.objectContaining({ devices: ["cam", "mic"], type: "unknown" })
      );
    });

    test("MediaDevicesError without a kind uses lastMicrophoneError to pin the device", () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      roomOf(transport).localParticipant.lastMicrophoneError = new Error(
        "mic boom"
      );

      roomOf(transport).emit(
        RoomEvent.MediaDevicesError,
        new Error("no kind reported")
      );

      expect(spies.onDeviceError).toHaveBeenCalledWith(
        expect.objectContaining({ devices: ["mic"] })
      );
    });
  });

  describe("devicechange reselection", () => {
    // livekit-client's own Room already reselects a default audiooutput on
    // devicechange (and updates every remote <audio> element's sinkId while
    // doing it — see updateSpeaker()'s comment), but it deliberately skips
    // audioinput/videoinput, so this is ours to handle.
    test("a live mic whose selected device disappears is restarted onto a fresh default", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices(); // selects mic-1
      const track = localAudioTrackOf(transport)!;

      mediaDevices.enumerateDevices.mockResolvedValue(
        DEFAULT_DEVICES.filter((d) => d.deviceId !== "mic-1")
      );
      track.restartTrack.mockImplementationOnce(async function (
        this: typeof track
      ) {
        this.__deviceId = "mic-2";
      });

      await triggerDeviceChange(transport);

      expect(track.restartTrack).toHaveBeenCalledWith({});
      expect(spies.onMicUpdated).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: "mic-2" })
      );
    });

    test("a disabled cam (no live track) is left alone — nothing to reacquire", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableCam: false });

      mediaDevices.enumerateDevices.mockResolvedValue(
        DEFAULT_DEVICES.filter((d) => d.kind !== "videoinput")
      );

      await expect(triggerDeviceChange(transport)).resolves.toBeUndefined();
      expect(createLocalVideoTrack).not.toHaveBeenCalled();
    });

    test("nothing happens when the selected devices are all still present", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();
      const track = localAudioTrackOf(transport)!;
      (track.restartTrack as Mock).mockClear();
      spies.onMicUpdated.mockClear();

      await triggerDeviceChange(transport);

      expect(track.restartTrack).not.toHaveBeenCalled();
      expect(spies.onMicUpdated).not.toHaveBeenCalled();
    });

    test("a restartTrack failure during reselection is reported through onDeviceError", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();
      const track = localAudioTrackOf(transport)!;

      mediaDevices.enumerateDevices.mockResolvedValue(
        DEFAULT_DEVICES.filter((d) => d.deviceId !== "mic-1")
      );
      track.restartTrack.mockRejectedValueOnce(new Error("no devices left"));

      await triggerDeviceChange(transport);

      expect(spies.onDeviceError).toHaveBeenCalledWith(
        expect.objectContaining({ devices: ["mic"] })
      );
    });

    // Regression: reacquiring by calling restartTrack({}) (no deviceId) picks
    // up today's concrete default device, but getSettings().deviceId then
    // reports *that device's own hash*, not "default" — silently converting
    // "always follow the system default" into "pinned to whichever device
    // happened to be default at the moment of the first devicechange". Every
    // devicechange after that first one then sees a real (non-"default")
    // current.deviceId, so defaultChanged can never be true again and
    // reselection stops working. Explicitly requesting the virtual "default"
    // device on every reselect keeps it sticky across repeated changes.
    test("a mic following the system default keeps deviceId 'default' across repeated default changes", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices(); // selects mic-1
      const track = localAudioTrackOf(transport)!;

      const devicesWithDefault = (label: string) => [
        { kind: "audioinput", deviceId: "default", label, groupId: "g1" },
        ...DEFAULT_DEVICES,
      ];

      mediaDevices.enumerateDevices.mockResolvedValue(
        devicesWithDefault("Default - Mic 1")
      );
      await transport.updateMic("default");
      expect((transport as unknown as { _selectedMic: MediaDeviceInfo })._selectedMic.deviceId).toBe("default");

      // System default flips to Mic 2 — the "default" alias entry's label
      // changes, but every device is still present.
      mediaDevices.enumerateDevices.mockResolvedValue(
        devicesWithDefault("Default - Mic 2")
      );
      await triggerDeviceChange(transport);

      expect(track.restartTrack).toHaveBeenLastCalledWith({
        deviceId: { exact: "default" },
      });
      expect(spies.onMicUpdated).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: "default" })
      );

      // System default flips again, back to Mic 1. If the fix regressed
      // (e.g. reacquiring with restartTrack({}) instead of the exact-default
      // constraint) this second change would silently no-op.
      mediaDevices.enumerateDevices.mockResolvedValue(
        devicesWithDefault("Default - Mic 1")
      );
      await triggerDeviceChange(transport);

      expect(track.restartTrack).toHaveBeenLastCalledWith({
        deviceId: { exact: "default" },
      });
    });
  });

  describe("participants & tracks", () => {
    test("ParticipantConnected maps a remote participant and fires onParticipantJoined", () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      // A plain object is not `instanceof` the mock LocalParticipant, so it is
      // mapped as a remote (local: false) participant.
      roomOf(transport).emit(RoomEvent.ParticipantConnected, {
        identity: "bot-1",
        name: "Bot",
      });

      expect(spies.onParticipantJoined).toHaveBeenCalledWith({
        id: "bot-1",
        name: "Bot",
        local: false,
      });
    });

    test("LocalTrackPublished for a mic/cam source does not fire onTrackStarted (owned by initDevices()/enableMic()/enableCam() instead)", () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      const mediaStreamTrack = {
        getSettings: () => ({ deviceId: "cam-1" }),
      } as unknown as MediaStreamTrack;
      roomOf(transport).emit(
        RoomEvent.LocalTrackPublished,
        { source: Track.Source.Camera, track: { mediaStreamTrack } },
        roomOf(transport).localParticipant
      );

      expect(spies.onTrackStarted).not.toHaveBeenCalled();
      expect(spies.onCamUpdated).not.toHaveBeenCalled();
    });

    test("LocalTrackPublished/Unpublished for a screen-share source fires onScreenTrackStarted/Stopped, not the generic onTrackStarted/Stopped", () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      const mediaStreamTrack = {} as MediaStreamTrack;
      roomOf(transport).emit(
        RoomEvent.LocalTrackPublished,
        { source: Track.Source.ScreenShare, track: { mediaStreamTrack } },
        roomOf(transport).localParticipant
      );
      roomOf(transport).emit(
        RoomEvent.LocalTrackUnpublished,
        { source: Track.Source.ScreenShare, track: { mediaStreamTrack } },
        roomOf(transport).localParticipant
      );

      expect(spies.onScreenTrackStarted).toHaveBeenCalledWith(
        mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
      expect(spies.onScreenTrackStopped).toHaveBeenCalledWith(
        mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
      expect(spies.onTrackStarted).not.toHaveBeenCalled();
      expect(spies.onTrackStopped).not.toHaveBeenCalled();
    });

    test("tracks(): local audio/video reflect the owned track even before connecting", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      await transport.initDevices();

      const track = localAudioTrackOf(transport)!;
      expect(transport.tracks().local.audio).toBe(track.mediaStreamTrack);
    });

    test("tracks() exposes the bot participant's mic track as the bot audio", () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      const botTrack = {} as MediaStreamTrack;
      const bot = {
        identity: "bot-1",
        name: "Bot",
        getTrackPublication: (s: string) =>
          s === Track.Source.Microphone
            ? { track: { mediaStreamTrack: botTrack } }
            : undefined,
      };
      roomOf(transport).remoteParticipants.set("bot-1", bot);
      roomOf(transport).emit(RoomEvent.ParticipantConnected, bot);

      expect(transport.tracks().bot?.audio).toBe(botTrack);
    });

    test("first ParticipantConnected fires onBotConnected; its ParticipantDisconnected fires onBotDisconnected", () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      const bot = { identity: "bot-1", name: "Bot" };
      const otherHuman = { identity: "human-1", name: "Human" };

      roomOf(transport).emit(RoomEvent.ParticipantConnected, bot);
      expect(spies.onBotConnected).toHaveBeenCalledTimes(1);
      expect(spies.onBotConnected).toHaveBeenCalledWith({
        id: "bot-1",
        name: "Bot",
        local: false,
      });

      // A second participant joining is not re-treated as the bot.
      roomOf(transport).emit(RoomEvent.ParticipantConnected, otherHuman);
      expect(spies.onBotConnected).toHaveBeenCalledTimes(1);

      roomOf(transport).emit(RoomEvent.ParticipantDisconnected, otherHuman);
      expect(spies.onBotDisconnected).not.toHaveBeenCalled();

      roomOf(transport).emit(RoomEvent.ParticipantDisconnected, bot);
      expect(spies.onBotDisconnected).toHaveBeenCalledTimes(1);
      expect(spies.onBotDisconnected).toHaveBeenCalledWith({
        id: "bot-1",
        name: "Bot",
        local: false,
      });
    });
  });

  describe("_validateConnectionParams", () => {
    test("passes an object through unchanged", () => {
      const params = { url: "wss://lk.example", token: "tok" };
      expect(transport._validateConnectionParams(params)).toBe(params);
    });

    test("returns undefined for null / non-object input", () => {
      expect(transport._validateConnectionParams(null)).toBeUndefined();
      expect(transport._validateConnectionParams("nope")).toBeUndefined();
    });
  });
});
