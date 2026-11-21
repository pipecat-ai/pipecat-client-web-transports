/**
 * Fakes for the @moq/* stack MoqTransport drives, for the device contract
 * suite. Mock each module with its factory, e.g.:
 *
 *   vi.mock("@moq/publish", async () =>
 *     (await import("./fakes/moq")).publishModule());
 *
 * The real @moq/signals is used throughout, so the transport's reactive
 * wiring runs for real against these fakes.
 *
 * Modeled behavior of the local mic (ported from @moq/publish 0.5.6's
 * Source.Microphone and Source.Device, which own getUserMedia):
 * - A Microphone captures whenever its `enabled` signal is true: it calls
 *   getUserMedia right away (no permission step first) and publishes the
 *   track on `out.source` as `{ audio: { track, kind: "voice" } }`.
 *   Turning `enabled` false stops the track (the capture effect's cleanup)
 *   and clears `out.source`; turning it back on captures afresh.
 * - A getUserMedia failure (a blocked mic) sets `out.error` and leaves the
 *   capture terminal: it isn't retried until the device's `permission`
 *   signal goes from false to true, or `enabled` goes false and back on.
 *   Nothing in the stack reports the failure any other way.
 * - close() stops the capture and releases the device.
 * - Device.permission starts false, then follows the Permissions API
 *   (granted unless DeviceLog.blocked.mic). Successful captures set it
 *   true. Device.requestPermission() does nothing once permission is true;
 *   otherwise it opens and immediately stops a getUserMedia stream,
 *   setting permission on success and ignoring a failure. That probe
 *   stream is not reported to the DeviceLog (which keeps one on/off per
 *   kind, so its stop would mask a live capture), so the brief mic blip a
 *   real probe causes is not visible to the suite.
 * - Device.available lists the mics once permission is known to be
 *   granted, and stays undefined while the mic is blocked (the browser
 *   hides device ids until permission is granted).
 *
 * Unsure / not modeled:
 * - A real browser fires a PermissionStatus "change" event when the user
 *   unblocks the mic, which would flip Device.permission and make a
 *   terminal Microphone retry on its own. Flipping DeviceLog.blocked
 *   doesn't fire anything here, so a blocked capture stays terminal until
 *   the transport does something (as it would if the user never granted).
 * - The Retry backoff (3 attempts with delays) for tracks that die is not
 *   modeled; a blocked getUserMedia is terminal on the first try, as in
 *   the real Retry.terminal() path.
 *
 * Network: a Connection goes "connected" a tick after it's created, and
 * the bot is announced on its origin with an audio rendition (so
 * sendReadyMessage() doesn't wait out its 20s timeout) and a transcript
 * track. When the client's transcript producer appends client-ready, the
 * bot appends bot-ready to its transcript, which the transport drains
 * into PipecatClient. A connect is failed by handing the transport an
 * unparseable relayUrl for that one connect (see failNextConnect()), so
 * _connect() throws the way it does for a bad relay URL.
 */

import { Effect, Signal } from "@moq/signals";

import { currentDevices, makeStream, makeTrack } from "./media";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

type Record_ = Record<string, unknown>;

/**
 * One subscription to the bot's transcript track. Closing it (the
 * transport does when a session ends) ends its stream, so a consumer
 * still draining it gets undefined rather than a later session's records.
 */
class BotTranscriptSubscription {
  private _queue: Record_[] = [];
  private _waiters: ((record: Record_ | undefined) => void)[] = [];
  closed = false;

  constructor(private _onClose: (sub: BotTranscriptSubscription) => void) {}

  push(record: Record_) {
    const waiter = this._waiters.shift();
    if (waiter) waiter(record);
    else this._queue.push(record);
  }

  next(): Promise<Record_ | undefined> {
    if (this._queue.length) return Promise.resolve(this._queue.shift());
    if (this.closed) return Promise.resolve(undefined);
    return new Promise((resolve) => this._waiters.push(resolve));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this._waiters.splice(0).forEach((resolve) => resolve(undefined));
    this._onClose(this);
  }
}

/** Per-test network state: the bot's transcript, and connect failures. */
class FakeMoqWorld {
  private _failNextConnect = false;
  // Records the bot sent with no subscription open, for the next one.
  private _unsent: Record_[] = [];
  private _subscriptions = new Set<BotTranscriptSubscription>();

  failNextConnect() {
    this._failNextConnect = true;
  }

  /** Connect params whose relayUrl is unparseable once failNextConnect(). */
  connectParams(): Record_ {
    const world = this;
    return {
      get relayUrl() {
        if (world._failNextConnect) {
          world._failNextConnect = false;
          return "not a relay url";
        }
        return "https://relay.fake/moq";
      },
    };
  }

  /** A record from the client's transcript reached the bot. */
  clientSent(record: Record_) {
    if (record?.type === "client-ready") {
      void tick().then(() =>
        this._botSend({
          label: "rtvi-ai",
          type: "bot-ready",
          id: "bot-ready-1",
          data: { version: "2.3.0" },
        })
      );
    }
  }

  private _botSend(record: Record_) {
    if (this._subscriptions.size === 0) this._unsent.push(record);
    for (const sub of this._subscriptions) sub.push(record);
  }

  /** Subscribe to the bot's transcript track. */
  subscribeBotTranscript(): BotTranscriptSubscription {
    const sub = new BotTranscriptSubscription((s) =>
      this._subscriptions.delete(s)
    );
    this._subscriptions.add(sub);
    this._unsent.splice(0).forEach((record) => sub.push(record));
    return sub;
  }
}

export const moqWorlds: { current: FakeMoqWorld | null } = { current: null };

export function createFakeMoqWorld(): FakeMoqWorld {
  liveMicTracks.clear();
  moqWorlds.current = new FakeMoqWorld();
  return moqWorlds.current;
}

function world(): FakeMoqWorld {
  if (!moqWorlds.current)
    throw new Error("No FakeMoqWorld: call createFakeMoqWorld()");
  return moqWorlds.current;
}

/** Make a fake track pass the transport's `instanceof MediaStreamTrack`. */
function asMediaStreamTrack(track: MediaStreamTrack): MediaStreamTrack {
  if (typeof MediaStreamTrack !== "undefined") {
    Object.setPrototypeOf(track, MediaStreamTrack.prototype);
  }
  return track;
}

/**
 * The mic tracks currently capturing. The mic is on while any is: a
 * Microphone that re-captures (new constraints, say) opens the new track
 * before its cleanup stops the old one, so tracks overlap, and a single
 * track's stop must not read as the mic going off.
 */
const liveMicTracks = new Set<MediaStreamTrack>();

function reportMic() {
  currentDevices().set("mic", liveMicTracks.size > 0);
}

/** getUserMedia({ audio }) over the current DeviceLog. */
async function micGetUserMedia(): Promise<MediaStream> {
  if (currentDevices().blocked.mic) {
    const error = new Error("Permission denied");
    error.name = "NotAllowedError";
    throw error;
  }
  const track = makeTrack("audio");
  const enabled = Object.getOwnPropertyDescriptor(track, "enabled")!;
  const stop = track.stop.bind(track);
  const update = () => {
    if (track.readyState === "live" && track.enabled) liveMicTracks.add(track);
    else liveMicTracks.delete(track);
    reportMic();
  };
  Object.defineProperty(track, "enabled", {
    configurable: true,
    get: enabled.get,
    set(value: boolean) {
      enabled.set!.call(track, value);
      update();
    },
  });
  track.stop = () => {
    stop();
    update();
  };
  update();
  return makeStream([track]);
}

type Getter<T> = { peek(): T; subscribe(fn: (v: T) => void): () => void };

function getterOf<T>(value: T | Getter<T> | undefined, fallback: T): Getter<T> {
  if (value && typeof (value as Getter<T>).peek === "function")
    return value as Getter<T>;
  return new Signal<T>((value as T | undefined) ?? fallback);
}

// ---- @moq/publish -----------------------------------------------------------

class FakeDevice {
  readonly kind = "audio";
  preferred: Signal<string | undefined>;
  private _out = {
    available: new Signal<MediaDeviceInfo[] | undefined>(undefined),
    default: new Signal<string | undefined>(undefined),
    requested: new Signal<string | undefined>(undefined),
    active: new Signal<string | undefined>(undefined),
    permission: new Signal(false),
  };
  readonly out = this._out;
  private _effect = new Effect();

  constructor(props?: { preferred?: string | Signal<string | undefined> }) {
    this.preferred =
      props?.preferred instanceof Signal
        ? props.preferred
        : new Signal<string | undefined>(props?.preferred);
    // List the mics whenever permission changes, as the real Device does.
    this._effect.run((eff) => {
      eff.get(this._out.permission);
      eff.spawn(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (eff.abort?.aborted) return;
        if (currentDevices().blocked.mic) {
          this._out.available.set(undefined);
          return;
        }
        this._out.permission.set(true);
        this._out.available.set(devices.filter((d) => d.kind === "audioinput"));
      });
    });
    this._effect.run((eff) => {
      const preferred = eff.get(this.preferred);
      const known =
        eff.get(this._out.available)?.some((d) => d.deviceId === preferred) ??
        false;
      this._out.requested.set(preferred && known ? preferred : undefined);
    });
    void navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((status) => this._out.permission.set(status.state === "granted"))
      .catch(() => {});
  }

  capture(deviceId: string | undefined) {
    this._out.permission.set(true);
    this._out.active.set(deviceId);
    return () => {
      if (this._out.active.peek() === deviceId) this._out.active.set(undefined);
    };
  }

  requestPermission() {
    if (this._out.permission.peek()) return;
    // The real probe opens a getUserMedia stream and stops it at once. It
    // is not reported to the DeviceLog: the log keeps one on/off per kind,
    // so the probe's stop would read as the mic going off even while the
    // Microphone's own capture is live.
    void tick().then(() => {
      if (!currentDevices().blocked.mic) this._out.permission.set(true);
    });
  }

  close() {
    this._effect.close();
  }
}

class FakeMicrophone {
  readonly in: { enabled: Getter<boolean> };
  readonly device: FakeDevice;
  constraints: Signal<MediaTrackConstraints | undefined>;
  private _out = {
    source: new Signal<
      { audio: { track: MediaStreamTrack; kind: string } } | undefined
    >(undefined),
    error: new Signal<Error | undefined>(undefined),
  };
  readonly out = this._out;
  private _effect = new Effect();
  // The real Retry budget, reduced to its terminal case: a failed
  // getUserMedia stops capturing until permission is granted. Bumping
  // `_refunds` reruns the capture effect with the budget restored.
  private _terminal = false;
  private _refunds = new Signal(0);

  constructor(props?: {
    enabled?: boolean | Getter<boolean>;
    device?: { preferred?: string | Signal<string | undefined> };
    constraints?:
      MediaTrackConstraints | Signal<MediaTrackConstraints | undefined>;
  }) {
    this.in = { enabled: getterOf(props?.enabled, true) };
    this.device = new FakeDevice(props?.device);
    this.constraints =
      props?.constraints instanceof Signal
        ? props.constraints
        : new Signal<MediaTrackConstraints | undefined>(props?.constraints);
    this._effect.run(this._capture.bind(this));
  }

  private _refund() {
    this._terminal = false;
    this._refunds.update((n) => n + 1);
  }

  private _capture(eff: Effect) {
    eff.get(this._refunds);
    if (!eff.get(this.in.enabled as never)) {
      this._terminal = false;
      this._out.error.set(undefined);
      return;
    }
    const requested = eff.get(this.device.out.requested);
    const constraints = eff.get(this.constraints);
    if (this._terminal) {
      const before = this.device.out.permission.peek();
      eff.subscribe(this.device.out.permission, (granted) => {
        if (granted && !before) this._refund();
      });
      return;
    }
    this._out.error.set(undefined);
    eff.spawn(async () => {
      // Constraints and the requested deviceId don't change what the fake
      // captures; they matter only as inputs that rerun the capture.
      void constraints;
      void requested;
      const pending = micGetUserMedia();
      eff.cleanup(
        () =>
          void pending.then(
            (stream) => stream.getTracks().forEach((t) => t.stop()),
            () => {}
          )
      );
      let stream: MediaStream | undefined;
      try {
        stream = await eff.race(pending);
      } catch (error) {
        if (eff.abort?.aborted) return;
        this._out.error.set(
          error instanceof Error ? error : new Error(String(error))
        );
        // Retry.terminal() reruns the effect, which then waits on permission.
        this._terminal = true;
        this._refunds.update((n) => n + 1);
        return;
      }
      if (eff.abort?.aborted || !stream) return;
      const track = asMediaStreamTrack(stream.getAudioTracks()[0]);
      eff.cleanup(this.device.capture(track.getSettings().deviceId));
      eff.set(this._out.source, { audio: { track, kind: "voice" } }, undefined);
    });
  }

  close() {
    this._effect.close();
    this.device.close();
  }
}

export function publishModule() {
  return {
    Broadcast: class {
      // The broadcast's net-level producer appears once it is announced.
      net = new Signal<unknown>(undefined);
      constructor(_props: unknown) {
        void tick().then(() =>
          this.net.set({
            createTrack: (_name: string) => ({ name: _name, close() {} }),
          })
        );
      }
      close() {}
    },
    Audio: {
      Capture: class {
        constructor(_props: unknown) {}
        close() {}
      },
      Encoder: class {
        constructor(_name: string, _props: unknown) {}
        close() {}
      },
    },
    Source: { Microphone: FakeMicrophone, Device: FakeDevice },
  };
}

// ---- @moq/watch -------------------------------------------------------------

export function watchModule() {
  return {
    Broadcast: class {
      constructor(_props: unknown) {}
      close() {}
    },
    Sync: class {
      constructor(_props: unknown) {}
      close() {}
      reset() {}
    },
    Audio: {
      // The bot's audio rendition is found a tick after subscribing.
      Source: class {
        out = {
          track: new Signal<unknown>(undefined),
          config: new Signal<unknown>(undefined),
        };
        constructor(_props: unknown) {
          void tick().then(() => {
            this.out.track.set({ name: "audio/data" });
            this.out.config.set({
              codec: "opus",
              sampleRate: 48000,
              numberOfChannels: 1,
            });
          });
        }
        close() {}
      },
      Decoder: class {
        static supported = undefined;
        out = { context: new Signal(undefined), root: new Signal(undefined) };
        constructor(_props: unknown) {}
        close() {}
        reset() {}
      },
      Emitter: class {
        constructor(_props: unknown) {}
        close() {}
      },
    },
  };
}

// ---- @moq/net ---------------------------------------------------------------

export function netModule() {
  class Connection {
    status = new Signal<"connecting" | "connected" | "disconnected">(
      "connecting"
    );
    error = new Signal<Error | undefined>(undefined);
    origin = new Signal<unknown>(undefined);
    probe = {};
    private _closed = false;
    constructor(_props: unknown) {
      void tick().then(() => {
        if (this._closed) return;
        this.origin.set({
          // The bot is announced, so a request for it resolves at once.
          request: (_path: string, _opts: unknown) => ({
            active: new Signal<unknown>({
              track: (_name: string) => ({
                subscribe: () => world().subscribeBotTranscript(),
              }),
            }),
            close() {},
          }),
        });
        this.status.set("connected");
      });
    }
    close() {
      this._closed = true;
      this.status.set("disconnected");
    }
  }
  return {
    Connection,
    Path: { from: (...parts: string[]) => parts.join("/") },
  };
}

// ---- @moq/json --------------------------------------------------------------

export function jsonModule() {
  return {
    Stream: {
      // The client's transcript: what it appends reaches the bot.
      Producer: class {
        constructor(_props: unknown) {}
        append(record: Record_) {
          world().clientSent(record);
        }
        finish() {}
      },
      // The bot's transcript, read from one subscription to its track.
      Consumer: class {
        private _track: BotTranscriptSubscription;
        constructor(props: { track: BotTranscriptSubscription }) {
          this._track = props.track;
        }
        next() {
          return this._track.next();
        }
      },
    },
  };
}

// ---- @moq/hang --------------------------------------------------------------
// Its root barrel uses directory imports Node ESM rejects (see
// tests/src/transports/moq.spec.ts); nothing here exercises it.

export function hangModule() {
  return {};
}

export function hangCatalogModule() {
  return { PRIORITY: { catalog: 0, audio: 1 }, decode: () => undefined };
}

export function hangContainerModule() {
  return {
    Consumer: class {
      close() {}
      async next() {
        return null;
      }
    },
    Legacy: { Format: class {} },
  };
}
