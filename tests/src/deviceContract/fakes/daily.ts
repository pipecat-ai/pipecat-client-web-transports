/**
 * A daily-js call object that models local media the way daily-js does,
 * for DailyTransport and DailyMediaManager. Mock the module with:
 *
 *   vi.mock("@daily-co/daily-js", async () =>
 *     (await import("../deviceContract/fakes/daily")).dailyModule);
 *
 * Modeled behavior (daily-js semantics the suite depends on):
 * - meetingState() goes "new" -> "loading" (startCamera() called, this
 *   tick) -> "loaded" -> "joining-meeting" -> "joined-meeting", and to
 *   "left-meeting" on leave() or "error" on a failed join(). Local media
 *   runs in "loading" through "joined-meeting".
 * - leave() stops both devices (without track-stopped events, as daily-js
 *   does) and fires left-meeting even if the call never joined. Local media
 *   then needs another startCamera() or join().
 * - startCamera() starts local media with the mic / cam on as
 *   startAudioOff / startVideoOff say. Called again once started it changes
 *   nothing and just returns the devices.
 * - join() starts local media the same way if it isn't running. If it is
 *   (startCamera() ran first), join() leaves the devices as they are.
 * - The "loaded" event fires when loading finishes (startCamera(), or join()
 *   straight from "new"), with the devices already on.
 * - setLocalAudio() / setLocalVideo() do nothing until "loaded": before local
 *   media starts, while it's loading, and after leave(). From then on they
 *   turn the device on or off, asynchronously.
 * - Turning on a blocked device fails with a camera-error event
 *   (type "permissions") and leaves it off; turning it on again retries.
 * - The local participant exists only during a media session.
 * - Once joined, a bot participant with an audio track is present, and the
 *   bot answers the client-ready app message with bot-ready.
 */

import type { DeviceKind, DeviceLog } from "../harness";
import { currentDevices, FAKE_DEVICES, fakeDevice, makeTrack } from "./media";

type Handler = (event: Record<string, unknown>) => void;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const BOT_ID = "bot-session";

export class FakeDailyCall {
  /** Make the next join() reject. */
  failNextJoin = false;

  private _meetingState:
    | "new"
    | "loading"
    | "loaded"
    | "joining-meeting"
    | "joined-meeting"
    | "left-meeting"
    | "error" = "new";
  private _loaded: Promise<void> | null = null;
  private _on: Record<DeviceKind, boolean> = { mic: false, cam: false };
  private _tracks: Record<DeviceKind, MediaStreamTrack | undefined> = {
    mic: undefined,
    cam: undefined,
  };
  private _botAudio = makeTrack("audio");
  private _handlers = new Map<string, Set<Handler>>();

  constructor(private _devices: DeviceLog) {}

  on(event: string, handler: Handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: Handler) {
    this._handlers.get(event)?.delete(handler);
    return this;
  }

  once(event: string, handler: Handler) {
    const wrapped: Handler = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  private _emit(event: string, payload: Record<string, unknown> = {}) {
    for (const handler of [...(this._handlers.get(event) ?? [])]) {
      handler({ action: event, ...payload });
    }
  }

  // ---- media -------------------------------------------------------------

  meetingState() {
    return this._meetingState;
  }

  private get _mediaStopped() {
    return ["new", "left-meeting", "error"].includes(this._meetingState);
  }

  private get _mediaRunning() {
    return !this._mediaStopped && this._meetingState !== "loading";
  }

  async startCamera(opts: Record<string, unknown> = {}) {
    if (this._mediaStopped) this._startMedia(opts);
    await this._loaded;
    await tick();
    return this._deviceInfos();
  }

  async join(opts: Record<string, unknown> = {}) {
    if (this._mediaStopped) this._startMedia(opts);
    await this._loaded;
    this._meetingState = "joining-meeting";
    await tick();
    if (this.failNextJoin) {
      this.failNextJoin = false;
      this._meetingState = "error";
      throw new Error("fake join failure");
    }
    this._meetingState = "joined-meeting";
    this._emit("joined-meeting", { participants: this.participants() });
    this._emit("participant-joined", { participant: this._bot() });
    this._emit("track-started", {
      participant: this._bot(),
      track: this._botAudio,
      type: "audio",
    });
    await tick();
    return this.participants();
  }

  async leave() {
    await tick();
    this._meetingState = "left-meeting";
    this._loaded = null;
    this._setDevice("mic", false, { silent: true });
    this._setDevice("cam", false, { silent: true });
    // daily-js fires left-meeting on every leave(), joined or not.
    this._emit("left-meeting");
  }

  setLocalAudio(enable: boolean) {
    this._setLocal("mic", enable);
    return this;
  }

  setLocalVideo(enable: boolean) {
    this._setLocal("cam", enable);
    return this;
  }

  private _setLocal(kind: DeviceKind, enable: boolean) {
    if (this._mediaRunning) {
      void tick().then(() => {
        if (this._mediaRunning) this._turn(kind, enable);
      });
    }
  }

  localAudio() {
    return this._on.mic;
  }

  localVideo() {
    return this._on.cam;
  }

  /** Start loading local media; it's on from the next tick. */
  private _startMedia(opts: Record<string, unknown>) {
    this._meetingState = "loading";
    const loaded: Promise<void> = tick().then(() => {
      if (this._loaded !== loaded) return; // left meanwhile
      this._meetingState = "loaded";
      if (!opts.startAudioOff) this._turn("mic", true);
      if (!opts.startVideoOff) this._turn("cam", true);
      this._emit("loaded");
    });
    this._loaded = loaded;
  }

  /** Turn a device on or off, failing to turn on a blocked one. */
  private _turn(kind: DeviceKind, on: boolean) {
    if (on && this._devices.blocked[kind]) {
      this._setDevice(kind, false);
      this._emit("camera-error", {
        error: {
          type: "permissions",
          blockedBy: "user",
          blockedMedia: [kind === "mic" ? "audio" : "video"],
          msg: "Permissions denied by user.",
        },
        errorMsg: { errorMsg: "not allowed" },
      });
      return;
    }
    this._setDevice(kind, on);
  }

  private _setDevice(
    kind: DeviceKind,
    on: boolean,
    { silent = false }: { silent?: boolean } = {}
  ) {
    if (this._on[kind] === on) return;
    this._on[kind] = on;
    const type = kind === "mic" ? "audio" : "video";
    if (on) this._tracks[kind] = makeTrack(type);
    const track = this._tracks[kind];
    this._devices.set(kind, on);
    if (!silent) this._emit(on ? "track-started" : "track-stopped", {
      participant: this._local(),
      track,
      type,
    });
    if (!on) this._tracks[kind] = undefined;
  }

  private _deviceInfos() {
    return {
      camera: this._devices.blocked.cam ? {} : { ...fakeDevice("cam") },
      mic: this._devices.blocked.mic ? {} : { ...fakeDevice("mic") },
      speaker: { ...FAKE_DEVICES[2] },
    };
  }

  // ---- participants ------------------------------------------------------

  private _local() {
    const track = (kind: DeviceKind) => {
      const t = this._on[kind] ? this._tracks[kind] : undefined;
      return {
        state: t ? "playable" : "off",
        persistentTrack: t,
        track: t,
      };
    };
    return {
      local: true,
      session_id: "local-session",
      user_id: "local-user",
      user_name: "",
      audio: this._on.mic,
      video: this._on.cam,
      tracks: { audio: track("mic"), video: track("cam") },
    };
  }

  private _bot() {
    return {
      local: false,
      session_id: BOT_ID,
      user_id: "bot",
      user_name: "Bot",
      tracks: {
        audio: {
          state: "playable",
          persistentTrack: this._botAudio,
          track: this._botAudio,
        },
      },
    };
  }

  participants() {
    const participants: Record<string, unknown> = {};
    if (this._mediaRunning) participants.local = this._local();
    if (this._meetingState === "joined-meeting") {
      participants[BOT_ID] = this._bot();
    }
    return participants;
  }

  // ---- messaging ---------------------------------------------------------

  sendAppMessage(message: { type?: string }) {
    if (message?.type === "client-ready") {
      void tick().then(() =>
        this._emit("app-message", {
          fromId: BOT_ID,
          data: {
            label: "rtvi-ai",
            type: "bot-ready",
            id: "bot-ready-1",
            data: { version: "2.3.0" },
          },
        })
      );
    }
    return this;
  }

  // ---- the rest of the surface the transports touch -----------------------

  async enumerateDevices() {
    return { devices: FAKE_DEVICES.map((d) => ({ ...d })) };
  }
  async room() {
    return {};
  }
  meetingSessionSummary() {
    return {};
  }
  async preAuth() {
    return {};
  }
  isLocalAudioLevelObserverRunning() {
    return false;
  }
  isRemoteParticipantsAudioLevelObserverRunning() {
    return false;
  }
  async startLocalAudioLevelObserver() {}
  async startRemoteParticipantsAudioLevelObserver() {}
  stopLocalAudioLevelObserver() {}
  stopRemoteParticipantsAudioLevelObserver() {}
  async setInputDevicesAsync() {
    return this._deviceInfos();
  }
  async setOutputDeviceAsync() {
    return { speaker: { ...FAKE_DEVICES[2] } };
  }
  startScreenShare() {}
  stopScreenShare() {}
  localScreenAudio() {
    return false;
  }
  localScreenVideo() {
    return false;
  }
  async destroy() {}
}

/** The call object the next createCallObject() / getCallInstance() returns. */
export const dailyCalls: { current: FakeDailyCall | null } = { current: null };

export function createFakeDailyCall(): FakeDailyCall {
  dailyCalls.current = new FakeDailyCall(currentDevices());
  return dailyCalls.current;
}

export const dailyModule = {
  default: {
    createCallObject: () => dailyCalls.current,
    getCallInstance: () => dailyCalls.current,
  },
};
