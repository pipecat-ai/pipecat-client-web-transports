/**
 * A livekit-client module that models local media the way livekit-client
 * does, for LiveKitTransport. Mock the module with:
 *
 *   vi.mock("livekit-client", async () =>
 *     (await import("./fakes/livekit")).livekitModule);
 *
 * Modeled behavior (livekit-client semantics the suite depends on):
 * - createLocalAudioTrack() / createLocalVideoTrack() call getUserMedia and
 *   return a live, unmuted LocalTrack. createLocalTracks() is one
 *   getUserMedia call for both, so it is all-or-nothing. A blocked device
 *   rejects with a NotAllowedError, like getUserMedia does.
 * - A device is on while its raw MediaStreamTrack is live and enabled.
 * - LocalAudioTrack.mute() / unmute() flip the raw track's `enabled` (the
 *   default stopOnMute: false). LocalVideoTrack.mute() stops the camera's
 *   raw track; unmute() re-acquires it (getUserMedia again, so it fails if
 *   the cam is blocked). restartTrack() always re-acquires.
 * - LocalParticipant.setMicrophoneEnabled() / setCameraEnabled() mute /
 *   unmute an existing publication for that source; with none, enabling
 *   creates and publishes a track, and disabling does nothing. A failed
 *   acquisition records lastMicrophoneError / lastCameraError, emits
 *   RoomEvent.MediaDevicesError and rethrows.
 * - Room.connect() connects, with a bot participant (identity "bot") that
 *   is already in the room and has a subscribed audio track. The bot
 *   answers the client-ready data message with bot-ready, delivered through
 *   RoomEvent.DataReceived.
 * - Room.disconnect() on a connected room unpublishes and stops the local
 *   tracks it published (stopOnUnpublish defaults to true), then emits
 *   RoomEvent.Disconnected. On a room that never connected it does
 *   nothing; tracks acquired outside the room are the caller's to stop.
 *
 * Unsure:
 * - Whether setMicrophoneEnabled()'s MediaDevicesError carries the device
 *   kind as its second argument in the version the transport uses. The
 *   fake passes it ("audioinput" / "videoinput").
 */

import type { DeviceKind, DeviceLog } from "../harness";
import { currentDevices, makeTrack } from "./media";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  Kind: { Audio: "audio", Video: "video" },
  Source: {
    Microphone: "microphone",
    Camera: "camera",
    ScreenShare: "screen_share",
    ScreenShareAudio: "screen_share_audio",
  },
};

const ConnectionState = {
  Disconnected: "disconnected",
  Connecting: "connecting",
  Connected: "connected",
  Reconnecting: "reconnecting",
  SignalReconnecting: "signal-reconnecting",
};

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

function permissionError(): Error {
  const error = new Error("Permission denied");
  error.name = "NotAllowedError";
  return error;
}

/** getUserMedia for one device, against the current DeviceLog. */
async function acquire(kind: DeviceKind): Promise<MediaStreamTrack> {
  await tick();
  const devices = currentDevices();
  if (devices.blocked[kind]) throw permissionError();
  return makeTrack(kind === "mic" ? "audio" : "video", devices);
}

class LocalTrack {
  isMuted = false;
  readonly source: string;

  constructor(
    readonly kind: "audio" | "video",
    public mediaStreamTrack: MediaStreamTrack
  ) {
    this.source =
      kind === "audio" ? Track.Source.Microphone : Track.Source.Camera;
  }

  private get _device(): DeviceKind {
    return this.kind === "audio" ? "mic" : "cam";
  }

  async mute() {
    if (this.isMuted) return this;
    if (this.kind === "video") this.mediaStreamTrack.stop();
    else this.mediaStreamTrack.enabled = false;
    this.isMuted = true;
    return this;
  }

  async unmute() {
    if (!this.isMuted) return this;
    if (this.kind === "video") {
      this.mediaStreamTrack = await acquire(this._device);
    } else {
      this.mediaStreamTrack.enabled = true;
    }
    this.isMuted = false;
    return this;
  }

  async restartTrack(_opts?: unknown) {
    const next = await acquire(this._device);
    this.mediaStreamTrack.stop();
    next.enabled = !this.isMuted;
    this.mediaStreamTrack = next;
  }

  stop() {
    this.mediaStreamTrack.stop();
  }
}

class LocalAudioTrack extends LocalTrack {}
class LocalVideoTrack extends LocalTrack {}

async function createLocalAudioTrack(_opts?: unknown) {
  return new LocalAudioTrack("audio", await acquire("mic"));
}

async function createLocalVideoTrack(_opts?: unknown) {
  return new LocalVideoTrack("video", await acquire("cam"));
}

async function createLocalTracks(opts: { audio?: unknown; video?: unknown }) {
  await tick();
  const devices = currentDevices();
  const wants: DeviceKind[] = [];
  if (opts.audio) wants.push("mic");
  if (opts.video) wants.push("cam");
  if (wants.some((kind) => devices.blocked[kind])) throw permissionError();
  return wants.map((kind) =>
    kind === "mic"
      ? new LocalAudioTrack("audio", makeTrack("audio", devices))
      : new LocalVideoTrack("video", makeTrack("video", devices))
  );
}

type Publication = { source: string; track: unknown; kind: string };

class LocalParticipant {
  identity = "local-user";
  name = "";
  isScreenShareEnabled = false;
  lastMicrophoneError: Error | undefined = undefined;
  lastCameraError: Error | undefined = undefined;
  publications = new Map<string, Publication>();

  constructor(private _room: Room) {}

  async publishTrack(track: LocalTrack) {
    await tick();
    const publication = { source: track.source, track, kind: track.kind };
    this.publications.set(track.source, publication);
    return publication;
  }

  getTrackPublication(source: string) {
    return this.publications.get(source);
  }

  async setMicrophoneEnabled(enable: boolean) {
    return this._setTrackEnabled(Track.Source.Microphone, enable);
  }

  async setCameraEnabled(enable: boolean) {
    return this._setTrackEnabled(Track.Source.Camera, enable);
  }

  async setScreenShareEnabled(_enable: boolean) {}

  private async _setTrackEnabled(source: string, enable: boolean) {
    const isMic = source === Track.Source.Microphone;
    const existing = this.publications.get(source);
    if (existing) {
      const track = existing.track as LocalTrack;
      try {
        if (enable) await track.unmute();
        else await track.mute();
      } catch (e) {
        this._failed(isMic, e as Error);
        throw e;
      }
      return existing;
    }
    if (!enable) return undefined;
    try {
      const track = isMic
        ? await createLocalAudioTrack()
        : await createLocalVideoTrack();
      return await this.publishTrack(track);
    } catch (e) {
      this._failed(isMic, e as Error);
      throw e;
    }
  }

  private _failed(isMic: boolean, error: Error) {
    if (isMic) this.lastMicrophoneError = error;
    else this.lastCameraError = error;
    this._room.emit(
      RoomEvent.MediaDevicesError,
      error,
      isMic ? "audioinput" : "videoinput"
    );
  }

  publishData(data: Uint8Array, _opts?: unknown) {
    const message = JSON.parse(new TextDecoder().decode(data));
    if (message?.type === "client-ready") {
      void tick().then(() =>
        this._room.emit(
          RoomEvent.DataReceived,
          new TextEncoder().encode(
            JSON.stringify({
              label: "rtvi-ai",
              type: "bot-ready",
              id: "bot-ready-1",
              data: { version: "2.3.0" },
            })
          ),
          this._room.remoteParticipants.get("bot")
        )
      );
    }
  }

  async waitUntilActive() {}
}

class RemoteParticipant {
  identity = "bot";
  name = "Bot";
  private _audio = {
    source: Track.Source.Microphone,
    kind: "audio",
    track: { kind: "audio", mediaStreamTrack: makeTrack("audio") },
  };

  getTrackPublication(source: string) {
    return source === Track.Source.Microphone ? this._audio : undefined;
  }
}

class Room {
  /** Make the next connect() reject. */
  static failNextConnect = false;

  state: string = ConnectionState.Disconnected;
  localParticipant: LocalParticipant;
  remoteParticipants = new Map<string, RemoteParticipant>();
  private _handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  constructor(public options?: unknown) {
    this.localParticipant = new LocalParticipant(this);
  }

  on(event: string, cb: (...args: unknown[]) => void) {
    (this._handlers[event] ??= []).push(cb);
    return this;
  }

  off(event: string, cb: (...args: unknown[]) => void) {
    this._handlers[event] = (this._handlers[event] ?? []).filter(
      (h) => h !== cb
    );
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const cb of [...(this._handlers[event] ?? [])]) cb(...args);
    return true;
  }

  async connect(_url: string, _token: string, _opts?: unknown) {
    this.state = ConnectionState.Connecting;
    await tick();
    if (Room.failNextConnect) {
      Room.failNextConnect = false;
      this.state = ConnectionState.Disconnected;
      throw new Error("fake connect failure");
    }
    this.remoteParticipants.set("bot", new RemoteParticipant());
    this.state = ConnectionState.Connected;
  }

  async disconnect() {
    if (this.state === ConnectionState.Disconnected) return;
    this.state = ConnectionState.Disconnected;
    for (const publication of this.localParticipant.publications.values()) {
      (publication.track as LocalTrack).stop();
    }
    this.localParticipant.publications.clear();
    this.remoteParticipants.clear();
    this.emit(RoomEvent.Disconnected);
  }

  async switchActiveDevice(_kind: string, _id: string) {
    return true;
  }
}

export function resetLivekit(_devices: DeviceLog): void {
  Room.failNextConnect = false;
}

export function failNextLivekitConnect(): void {
  Room.failNextConnect = true;
}

export const livekitModule = {
  ConnectionState,
  LocalAudioTrack,
  LocalParticipant,
  LocalVideoTrack,
  MediaDeviceFailure,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  createLocalTracks,
  createLocalVideoTrack,
};
