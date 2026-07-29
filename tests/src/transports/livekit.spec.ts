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

  class Room {
    options: unknown;
    localParticipant = new LocalParticipant();
    remoteParticipants = new Map<string, unknown>();
    connect = vi.fn(async (_u: string, _t: string, _o?: unknown) => {});
    disconnect = vi.fn(async () => {});
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
    LocalParticipant,
    RemoteParticipant,
    MediaDeviceFailure,
  };
});

import { LiveKitTransport } from "@pipecat-ai/livekit-transport";
// Values come from the mock above; only self-consistency with the source matters.
import { RoomEvent, Track } from "livekit-client";

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
  getUserMedia: Mock;
}

function stubMediaDevices(
  devices: MediaDeviceInfo[] = DEFAULT_DEVICES
): MediaDevicesStub {
  const stub: MediaDevicesStub = {
    enumerateDevices: vi.fn(async () => devices),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getUserMedia: vi.fn(
      async () => ({ getTracks: () => [] }) as unknown as MediaStream
    ),
  };
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: stub,
  });
  return stub;
}

// ---- internal fake-room accessor -------------------------------------------
interface FakeRoom {
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

// _connect / _validateConnectionParams take the non-exported LiveKitConnectParams;
// cast loose test objects through this helper to stay readable.
const connect = (t: LiveKitTransport, params: Record<string, unknown>) =>
  t._connect(params as never);

describe("LiveKitTransport — characterization", () => {
  let transport: LiveKitTransport;
  let mediaDevices: MediaDevicesStub;

  beforeEach(() => {
    mediaDevices = stubMediaDevices();
    transport = new LiveKitTransport();
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
    });

    test("sendReadyMessage() flips to 'ready', waits for the participant, then publishes client-ready", async () => {
      const { callbacks, recorder } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      recorder.states.length = 0;

      await transport.sendReadyMessage();

      expect(transport.state).toBe("ready");
      expect(recorder.states).toEqual(["ready"]);
      expect(roomOf(transport).localParticipant.waitUntilActive).toHaveBeenCalledTimes(1);
      expect(roomOf(transport).localParticipant.publishData).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        { reliable: true }
      );
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

    test("_connect() applies initialize()'s enableMic/enableCam to the local participant", async () => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks, { enableMic: true, enableCam: false });

      await connect(transport, { url: "wss://lk.example", token: "tok" });

      // With no pre-created (initDevices) tracks, an enabled device is turned
      // on via setXEnabled(true); a disabled one is left untouched.
      expect(roomOf(transport).localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
      expect(roomOf(transport).localParticipant.setCameraEnabled).not.toHaveBeenCalled();
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

    test("updateMic() switches the active device and fires onMicUpdated", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);

      await transport.updateMic("mic-2");

      expect(roomOf(transport).switchActiveDevice).toHaveBeenCalledWith(
        "audioinput",
        "mic-2"
      );
      expect(spies.onMicUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "mic-2" })
      );
    });

    test("updateMic() reports a switch failure through onDeviceError", async () => {
      const { callbacks, spies } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      roomOf(transport).switchActiveDevice.mockRejectedValueOnce(new Error("boom"));

      await transport.updateMic("mic-2");

      expect(spies.onDeviceError).toHaveBeenCalledTimes(1);
      expect(spies.onMicUpdated).not.toHaveBeenCalled();
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

    test("LocalTrackPublished fires onTrackStarted for the published local track", () => {
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

      expect(spies.onTrackStarted).toHaveBeenCalledWith(
        mediaStreamTrack,
        expect.objectContaining({ local: true })
      );
    });

    test("LocalTrackPublished resolves the selected camera and fires onCamUpdated", async () => {
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

      await vi.waitFor(() =>
        expect(spies.onCamUpdated).toHaveBeenCalledWith(
          expect.objectContaining({ deviceId: "cam-1" })
        )
      );
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
