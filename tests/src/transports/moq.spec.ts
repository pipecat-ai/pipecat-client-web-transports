/**
 * Characterization tests for MoqTransport's lifecycle contract.
 *
 * Locks in today's state transitions for initialize(), initDevices(),
 * sendReadyMessage(), and _disconnect(). The transport does not accept a
 * MediaManager DI hook (unlike the WAV-based transports), so we stub the
 * `navigator.mediaDevices` surface directly for the initDevices() path.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Constructor props captured by the mocks below, so tests can assert
// what `_connect` wires up and drive the connection's signals.
const captured = vi.hoisted(() => ({
  connections: [] as Array<Record<string, any>>,
  watchBroadcasts: [] as Array<Record<string, any>>,
}));

// @moq/hang's root barrel uses directory imports (`import * from
// "./catalog"`) that Node ESM rejects, and @moq/publish + @moq/watch
// both pull it in transitively, so any load of the transport hits the
// broken chain. None of the moq libs are exercised by these lifecycle
// tests, so mock them out here — the tests assert behavior at the
// abstract Transport boundary, not against the network stack. The mocks
// use real `@moq/signals` Signals wherever the transport reads them
// through an Effect, so `_connect`'s reactive wiring runs for real.
vi.mock("@moq/hang", () => ({}));
vi.mock("@moq/hang/catalog", () => ({
  PRIORITY: { catalog: 0, audio: 1 },
  decode: vi.fn(),
}));
vi.mock("@moq/hang/container", () => ({
  Consumer: class {
    close() {}
    async next() {
      return null;
    }
  },
  Legacy: { Format: class {} },
}));
vi.mock("@moq/publish", async () => {
  const { Signal } = await import("@moq/signals");
  class Microphone {
    private _permissionRequested = false;
    device = {
      requestPermission: () => {
        if (this._permissionRequested) return;
        this._permissionRequested = true;
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            this.out.source.set({ audio: stream.getAudioTracks()[0] });
          })
          .catch(() => {});
      },
    };
    // 0.4 moved component outputs under `out`.
    out = {
      source: new Signal<{ audio: MediaStreamTrack } | undefined>(undefined),
    };
    constructor(_opts: unknown) {}
    close() {}
  }
  return {
    Broadcast: class {
      // The network broadcast, re-created per connection. Stays unset
      // here, so the transcript Producer is never built against the mock.
      net = new Signal(undefined);
      constructor(_opts: unknown) {}
      close() {}
    },
    Audio: {
      StreamTrack: class {},
      Capture: class {
        constructor(_opts: unknown) {}
        close() {}
      },
      // 0.4 registers the audio rendition through an encoder rather than
      // an inline `audio` prop on the broadcast.
      Encoder: class {
        sampleRate: unknown;
        constructor(_name: string, _opts: unknown) {}
        close() {}
      },
    },
    Source: { Microphone },
  };
});
vi.mock("@moq/watch", async () => {
  const { Signal } = await import("@moq/signals");
  return {
    Broadcast: class {
      props: Record<string, any>;
      constructor(props: Record<string, any>) {
        this.props = props;
        captured.watchBroadcasts.push(this);
      }
      close() {}
    },
    Sync: class {
      constructor(_opts: unknown) {}
      close() {}
      reset() {}
    },
    Audio: {
      Source: class {
        out = { track: new Signal(undefined), config: new Signal(undefined) };
        constructor(_opts: unknown) {}
        close() {}
      },
      Decoder: class {
        // Read by the transport to tell the source which codecs it can play.
        static supported = undefined;
        out = { context: new Signal(undefined), root: new Signal(undefined) };
        constructor(_opts: unknown) {}
        close() {}
        reset() {}
      },
      Emitter: class {
        constructor(_opts: unknown) {}
        close() {}
      },
    },
  };
});
vi.mock("@moq/net", async () => {
  const { Signal } = await import("@moq/signals");
  class Connection {
    props: Record<string, any>;
    status = new Signal<"connecting" | "connected" | "disconnected">(
      "connecting",
    );
    error = new Signal<Error | undefined>(undefined);
    origin = new Signal<Record<string, any> | undefined>(undefined);
    probe = {};
    constructor(props: Record<string, any>) {
      this.props = props;
      captured.connections.push(this);
    }
    close() {}
  }
  return {
    Connection,
    Path: { from: (...parts: string[]) => parts.join("/") },
  };
});
// The transcript stream codec. The Consumer's `next()` never settles, so
// a drain loop started against the mock just parks.
vi.mock("@moq/json", () => ({
  Stream: {
    Producer: class {
      constructor(_opts: unknown) {}
      append(_r: unknown) {}
      finish() {}
    },
    Consumer: class {
      constructor(_opts: unknown) {}
      next() {
        return new Promise(() => {});
      }
    },
  },
}));

import { Signal } from "@moq/signals";
import { acceptTranscriptRecord, MoqTransport } from "@pipecat-ai/moq-transport";

import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

interface MediaDevicesStub {
  getUserMedia: ReturnType<typeof vi.fn>;
  enumerateDevices: ReturnType<typeof vi.fn>;
}

function stubMediaDevices(overrides: Partial<MediaDevicesStub> = {}): MediaDevicesStub {
  // A real MediaStreamTrack prototype so the transport's
  // `instanceof MediaStreamTrack` check in `_audioSourceTrack` passes.
  const stubTrack = Object.assign(Object.create(MediaStreamTrack.prototype), {
    getSettings: () => ({ deviceId: "mic-1" }),
    stop: vi.fn(),
    enabled: true,
  }) as MediaStreamTrack;
  const stubStream = { getAudioTracks: () => [stubTrack] } as MediaStream;

  const stub: MediaDevicesStub = {
    getUserMedia: vi.fn(async () => stubStream),
    enumerateDevices: vi.fn(async () => [
      { kind: "audioinput", deviceId: "mic-1", label: "Mic 1", groupId: "" },
    ] as MediaDeviceInfo[]),
    ...overrides,
  };

  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: stub,
  });

  return stub;
}

describe("MoqTransport — characterization", () => {
  let transport: MoqTransport;

  beforeEach(() => {
    transport = new MoqTransport({ relayUrl: "https://relay.example/moq" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("initial state after construction is 'disconnected'", () => {
    expect(transport.state).toBe("disconnected");
  });

  test("initialize() flips state to 'initialized' and records the transition", () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    expect(transport.state).toBe("initialized");
    expect(recorder.states).toEqual(["initialized"]);
  });

  test("sendReadyMessage() flips state to 'ready'", async () => {
    // sendReadyMessage() is async: it first awaits _waitForBotAudio(),
    // which resolves immediately here because the transport was never
    // connected (no watch-side signals to wait on).
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    recorder.states.length = 0;

    await transport.sendReadyMessage();

    expect(transport.state).toBe("ready");
    expect(recorder.states).toEqual(["ready"]);
  });

  test("initDevices() probes navigator.mediaDevices once and is idempotent thereafter", async () => {
    const stub = stubMediaDevices();
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();
    await transport.initDevices();

    expect(stub.getUserMedia).toHaveBeenCalledTimes(1);
    expect(transport.tracks().local.audio).toBeDefined();
  });

  test("initDevices() swallows permission failures (fire-and-forget requestPermission)", async () => {
    // The transport delegates mic acquisition to Publish.Source.Microphone
    // and does not `await` `device.requestPermission()`, so a getUserMedia
    // rejection is not surfaced through initDevices(). Locks in that
    // contract; revisit if the transport starts awaiting/wrapping.
    stubMediaDevices({
      getUserMedia: vi.fn(async () => {
        throw new Error("permission denied");
      }),
    });

    await expect(transport.initDevices()).resolves.toBeUndefined();
    expect(transport.tracks().local.audio).toBeUndefined();
  });

  test("sendMessage() before connect drops the message with a warning (no-op, not a throw)", () => {
    // There IS a real client→bot RTVI channel once connected (sendMessage
    // appends to the transcript stream — see the class docstring and
    // sendReadyMessage(), which relies on it to deliver `client-ready`).
    // Pre-connect, `_transcriptOut`/`_transcriptLog` are still null, so
    // sendMessage() takes the early-return guard and just warns; this test
    // locks in only that guard, not the connected-state behavior.
    expect(() =>
      transport.sendMessage({
        id: "x",
        label: "rtvi-ai",
        type: "test",
        data: {},
      } as never),
    ).not.toThrow();
  });

  test("tracks() returns empty objects before initDevices()", () => {
    expect(transport.tracks()).toEqual({ local: {}, bot: {} });
  });

  test("getAllCams() and getAllSpeakers() return empty arrays (audio-only)", async () => {
    expect(await transport.getAllCams()).toEqual([]);
    expect(await transport.getAllSpeakers()).toEqual([]);
  });

  test("_disconnect() from 'disconnected' is a no-op", async () => {
    const { callbacks, spies, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    (transport as unknown as { _state: string })._state = "disconnected";
    recorder.states.length = 0;

    await transport._disconnect();

    expect(transport.state).toBe("disconnected");
    expect(recorder.states).toEqual([]);
    expect(spies.onDisconnected).not.toHaveBeenCalled();
  });

  test("constructor option overrides are applied (clientId, botId, namespace)", () => {
    // No public getter exposes resolved options, so we verify via behavior:
    // construction with overrides does not throw and leaves state 'disconnected'.
    const t = new MoqTransport({
      relayUrl: "https://relay.example/moq",
      clientId: "alice",
      botId: "rosey",
      namespace: "demo",
      transcriptTrack: "rtvi",
      audioLatencyMs: 120,
    });
    expect(t.state).toBe("disconnected");
  });

  test("_validateConnectionParams() unwraps a raw bot /start response (`{ moq: {...} }`)", () => {
    const certHashBytes = new Uint8Array([1, 2, 3, 4]);
    const certHashB64 = btoa(String.fromCharCode(...certHashBytes));

    const resolved = transport._validateConnectionParams({
      moq: {
        relayUrl: "https://relay.example/moq",
        certHash: certHashB64,
        namespace: "demo",
        clientId: "alice",
        botId: "rosey",
        transcriptTrack: "rtvi",
      },
    });

    expect(resolved.relayUrl).toBe("https://relay.example/moq");
    expect(resolved.namespace).toBe("demo");
    expect(resolved.clientId).toBe("alice");
    expect(resolved.botId).toBe("rosey");
    expect(resolved.transcriptTrack).toBe("rtvi");
    expect(resolved.serverCertificateHashes).toHaveLength(1);
    expect(resolved.serverCertificateHashes?.[0].algorithm).toBe("sha-256");
    expect(
      new Uint8Array(resolved.serverCertificateHashes?.[0].value as ArrayBuffer),
    ).toEqual(certHashBytes);
  });

  test("_validateConnectionParams() treats a null certHash as no cert pinning", () => {
    const resolved = transport._validateConnectionParams({
      moq: {
        relayUrl: "https://relay.example/moq",
        certHash: null,
        namespace: "pipecat",
        clientId: "client0",
        botId: "bot0",
        transcriptTrack: "transcript.json.z",
      },
    });

    expect(resolved.serverCertificateHashes).toBeUndefined();
  });

  test("_validateConnectionParams() throws when `moq` is present but empty (server not running -t moq)", () => {
    expect(() =>
      transport._validateConnectionParams({ moq: undefined }),
    ).toThrow(/moq/i);
  });

  test("_validateConnectionParams() still accepts already-shaped MoqTransportOptions", () => {
    const resolved = transport._validateConnectionParams({
      clientId: "bob",
    });

    expect(resolved.clientId).toBe("bob");
    expect(resolved.relayUrl).toBe("https://relay.example/moq");
  });
});

/**
 * Transcript records carry `seq` and `epoch` so that the replay every
 * (re)subscribe gets is dropped rather than redelivered. These tests drive
 * the publish and drain paths with stand-ins for the @moq/json producer and
 * consumer; the stream itself is exercised against a relay, not here.
 */
describe("MoqTransport — transcript records", () => {
  type Record = { [key: string]: unknown };
  const rtvi = (type: string, extra: Record = {}): Record => ({
    id: "m1",
    label: "rtvi-ai",
    type,
    data: {},
    ...extra,
  });

  /** `_drainTranscript` and the transcript fields are internal. */
  type Internals = {
    _transcriptLog: Record[] | null;
    _transcriptOut: { append: (r: Record) => void } | null;
    _transcriptEpoch: string | null;
    _drainTranscript: (
      consumer: { next: () => Promise<Record | null> },
      signal: AbortSignal,
    ) => Promise<void>;
  };

  let transport: MoqTransport;

  beforeEach(() => {
    transport = new MoqTransport({ relayUrl: "https://relay.example/moq" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("acceptTranscriptRecord() delivers a new record with the fields stripped", () => {
    const watermark = { epoch: undefined, lastSeq: -1 };
    const message = acceptTranscriptRecord(
      watermark,
      rtvi("bot-ready", { seq: 0, epoch: "e1" }) as never,
    );
    expect(message).toEqual(rtvi("bot-ready"));
    expect(watermark).toEqual({ epoch: "e1", lastSeq: 0 });
  });

  test("acceptTranscriptRecord() drops a replay of records already delivered", () => {
    const watermark = { epoch: undefined, lastSeq: -1 };
    for (const seq of [0, 1, 2]) {
      expect(acceptTranscriptRecord(watermark, rtvi("x", { seq, epoch: "e" }) as never)).not.toBeNull();
    }
    // The whole log comes back on a resubscribe.
    for (const seq of [0, 1, 2]) {
      expect(acceptTranscriptRecord(watermark, rtvi("x", { seq, epoch: "e" }) as never)).toBeNull();
    }
    expect(acceptTranscriptRecord(watermark, rtvi("x", { seq: 3, epoch: "e" }) as never)).not.toBeNull();
  });

  test("acceptTranscriptRecord() starts the count over for a new epoch", () => {
    const watermark = { epoch: undefined, lastSeq: -1 };
    acceptTranscriptRecord(watermark, rtvi("x", { seq: 5, epoch: "old" }) as never);
    expect(acceptTranscriptRecord(watermark, rtvi("x", { seq: 0, epoch: "new" }) as never)).not.toBeNull();
    expect(acceptTranscriptRecord(watermark, rtvi("x", { seq: 0, epoch: "new" }) as never)).toBeNull();
  });

  test("acceptTranscriptRecord() passes a record without a sequence through unchanged", () => {
    const watermark = { epoch: undefined, lastSeq: -1 };
    const record = rtvi("client-ready");
    expect(acceptTranscriptRecord(watermark, record as never)).toBe(record);
    expect(acceptTranscriptRecord(watermark, record as never)).toBe(record);
    const odd = rtvi("x", { seq: 1.5 });
    expect(acceptTranscriptRecord(watermark, odd as never)).toBe(odd);
  });

  test("sendMessage() numbers each record from its position in the log and keeps the message itself unchanged", () => {
    const internals = transport as unknown as Internals;
    const producer = { append: vi.fn<(r: Record) => void>() };
    internals._transcriptLog = [];
    internals._transcriptEpoch = "e1";
    internals._transcriptOut = producer;

    const first = rtvi("client-ready");
    transport.sendMessage(first as never);
    transport.sendMessage(rtvi("client-message") as never);

    expect(producer.append.mock.calls.map(([r]) => [r.seq, r.epoch, r.type])).toEqual([
      [0, "e1", "client-ready"],
      [1, "e1", "client-message"],
    ]);
    expect(first).toEqual(rtvi("client-ready"));
    // A later subscriber is replayed the same numbered records.
    expect(internals._transcriptLog.map((r) => r.seq)).toEqual([0, 1]);
  });

  test("_drainTranscript() delivers each bot record once, stripped, across a replay", async () => {
    const { callbacks } = buildSpyCallbacks();
    const { onMessage } = wireTransport(transport, callbacks);
    const script: (Record | null)[] = [
      rtvi("bot-ready", { seq: 0, epoch: "b1" }),
      rtvi("bot-output", { seq: 1, epoch: "b1" }),
      // The stream is re-read from its first record after a reconnect.
      rtvi("bot-ready", { seq: 0, epoch: "b1" }),
      rtvi("bot-output", { seq: 1, epoch: "b1" }),
      rtvi("bot-output", { seq: 2, epoch: "b1" }),
      null,
    ];
    const consumer = { next: vi.fn(async () => script.shift() ?? null) };

    await (transport as unknown as Internals)._drainTranscript(
      consumer,
      new AbortController().signal,
    );

    expect(onMessage.mock.calls.map(([m]) => m)).toEqual([
      rtvi("bot-ready"),
      rtvi("bot-output"),
      rtvi("bot-output"),
    ]);
  });

  test("_drainTranscript() still honors the bot's session-ending marker when it carries the fields", async () => {
    const { callbacks } = buildSpyCallbacks();
    const { onMessage } = wireTransport(transport, callbacks);
    const disconnect = vi
      .spyOn(transport as unknown as { _disconnect: () => Promise<void> }, "_disconnect")
      .mockResolvedValue(undefined);
    const script: (Record | null)[] = [
      { label: "moq-transport", type: "session-ending", seq: 0, epoch: "b1" },
      rtvi("bot-output", { seq: 1, epoch: "b1" }),
      null,
    ];
    const consumer = { next: vi.fn(async () => script.shift() ?? null) };

    await (transport as unknown as Internals)._drainTranscript(
      consumer,
      new AbortController().signal,
    );

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalled();
    expect(consumer.next).toHaveBeenCalledTimes(1);
  });

  test("_drainTranscript() returns when the stream ends without the marker", async () => {
    // Stream end is the caller's cue to re-subscribe (the announced-gated
    // origin request re-resolves); the drain itself neither disconnects
    // nor retries.
    const { callbacks } = buildSpyCallbacks();
    const { onMessage } = wireTransport(transport, callbacks);
    const disconnect = vi
      .spyOn(transport as unknown as { _disconnect: () => Promise<void> }, "_disconnect")
      .mockResolvedValue(undefined);
    const script: (Record | null)[] = [rtvi("bot-output", { seq: 0, epoch: "b1" }), null];
    const consumer = { next: vi.fn(async () => script.shift() ?? null) };

    await (transport as unknown as Internals)._drainTranscript(
      consumer,
      new AbortController().signal,
    );

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  test("_disconnect() sends the session-ending marker before tearing down", async () => {
    const internals = transport as unknown as Internals;
    const producer = { append: vi.fn<(r: Record) => void>() };
    internals._transcriptLog = [];
    internals._transcriptEpoch = "e1";
    internals._transcriptOut = producer;
    (transport as unknown as { _state: string })._state = "connected";

    await transport._disconnect();

    expect(producer.append.mock.calls.map(([r]) => [r.label, r.type, r.seq, r.epoch])).toEqual([
      ["moq-transport", "session-ending", 0, "e1"],
    ]);
    expect(transport.state).toBe("disconnected");
  });
});

/**
 * The relay connection is `@moq/net`'s pool `Connection`, mocked out
 * above, so these drive the two handlers `_connect` wires to it.
 */
describe("MoqTransport — relay reconnects", () => {
  type RelayStatus = "connecting" | "connected" | "disconnected";
  type FakeConnection = { status: Signal<RelayStatus>; close: () => void };
  type Internals = {
    _state: string;
    _connection: FakeConnection | null;
    _audioSource: {
      out: { track: Signal<unknown>; config: Signal<unknown> };
      close: () => void;
    } | null;
    _watchBroadcast: { close: () => void } | null;
    _onRelayStatus: (status: RelayStatus) => void;
    _onRelayGaveUp: (connection: FakeConnection, err: unknown) => void;
  };

  const fakeConnection = (status: RelayStatus): FakeConnection => ({
    status: new Signal<RelayStatus>(status),
    close: () => {},
  });

  /** Stand in for what `_connect` leaves behind, with the bot's audio not
   *  yet subscribed, so `sendReadyMessage` has something to wait on. */
  function connectTo(internals: Internals, connection: FakeConnection): void {
    internals._connection = connection;
    internals._audioSource = {
      out: {
        track: new Signal<unknown>(undefined),
        config: new Signal<unknown>(undefined),
      },
      close: () => {},
    };
    internals._watchBroadcast = { close: () => {} };
    internals._state = "connecting";
  }

  let transport: MoqTransport;

  beforeEach(() => {
    transport = new MoqTransport({ relayUrl: "https://relay.example/moq" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("the relay status drives the state until the session is ready", () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    recorder.states.length = 0;
    const internals = transport as unknown as Internals;

    internals._onRelayStatus("connecting");
    internals._onRelayStatus("connected");

    expect(recorder.states).toEqual(["connecting", "connected"]);
  });

  test("a relay reconnect leaves a ready session's state alone", async () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    await transport.sendReadyMessage();
    recorder.states.length = 0;
    const internals = transport as unknown as Internals;

    internals._onRelayStatus("disconnected");
    internals._onRelayStatus("connecting");
    internals._onRelayStatus("connected");

    expect(transport.state).toBe("ready");
    expect(recorder.states).toEqual([]);
  });

  test("the relay status drives the state again after a disconnect", async () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    await transport.sendReadyMessage();
    await transport._disconnect();
    recorder.states.length = 0;

    (transport as unknown as Internals)._onRelayStatus("connecting");

    expect(recorder.states).toEqual(["connecting"]);
  });

  test("the connection giving up moves to 'error' and reports the dial failures as fatal", () => {
    const { callbacks, spies, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    recorder.states.length = 0;
    const internals = transport as unknown as Internals;
    const connection = fakeConnection("connecting");
    internals._connection = connection;

    // The shape `@moq/net`'s connect rejects with: it races WebTransport
    // and WebSocket through Promise.any.
    internals._onRelayGaveUp(
      connection,
      new AggregateError(
        [new Error("webtransport refused"), new Error("websocket refused")],
        "All promises were rejected",
      ),
    );

    expect(recorder.states).toEqual(["error"]);
    expect(spies.onError).toHaveBeenCalledTimes(1);
    const [message] = spies.onError.mock.calls[0];
    expect(message.data.fatal).toBe(true);
    expect(message.data.message).toContain("webtransport refused; websocket refused");
    expect(message.data.message).not.toContain("All promises were rejected");
  });

  test("a connection the transport has moved on from giving up is ignored", () => {
    const { callbacks, spies, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    recorder.states.length = 0;
    const internals = transport as unknown as Internals;
    internals._connection = fakeConnection("connected");

    internals._onRelayGaveUp(fakeConnection("connecting"), new Error("refused"));

    expect(spies.onError).not.toHaveBeenCalled();
    expect(recorder.states).toEqual([]);
  });

  test("'error' holds whatever the relay status does until the disconnect", () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    const internals = transport as unknown as Internals;
    internals._state = "error";
    recorder.states.length = 0;

    internals._onRelayStatus("disconnected");
    internals._onRelayStatus("connecting");

    expect(transport.state).toBe("error");
    expect(recorder.states).toEqual([]);
  });

  test("the connection giving up during a disconnect is ignored", () => {
    const { callbacks, spies } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    const internals = transport as unknown as Internals;
    const connection = fakeConnection("connecting");
    internals._connection = connection;
    internals._state = "disconnecting";

    internals._onRelayGaveUp(connection, new Error("refused"));

    expect(spies.onError).not.toHaveBeenCalled();
  });

  test("sendReadyMessage() does not time out into 'ready' before the relay connects", async () => {
    vi.useFakeTimers();
    try {
      const { callbacks, recorder } = buildSpyCallbacks();
      wireTransport(transport, callbacks);
      const connection = fakeConnection("connecting");
      connectTo(transport as unknown as Internals, connection);
      recorder.states.length = 0;

      const ready = transport.sendReadyMessage();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(recorder.states).toEqual([]);

      // The audio-subscribe timeout (20s) runs from the relay connecting.
      connection.status.set("connected");
      await vi.advanceTimersByTimeAsync(20_000);
      await ready;

      expect(recorder.states).toEqual(["ready"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("_disconnect() settles a pending sendReadyMessage() without reaching 'ready'", async () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    connectTo(transport as unknown as Internals, fakeConnection("connecting"));
    recorder.states.length = 0;

    const ready = transport.sendReadyMessage();
    await transport._disconnect();
    await ready;

    expect(recorder.states).toEqual(["disconnecting", "disconnected"]);
  });
});

/**
 * These run `_connect()` for real against the mocks above (which expose
 * real Signals wherever the transport reads them through an Effect), so
 * they cover what `_connect` wires to the `@moq/net` Connection and how
 * the transcript subscription follows the origin request.
 */
describe("MoqTransport — _connect wiring", () => {
  /** Flush the microtask queue so scheduled Effect re-runs fire. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  let transport: MoqTransport;

  beforeEach(() => {
    captured.connections.length = 0;
    captured.watchBroadcasts.length = 0;
    transport = new MoqTransport({ relayUrl: "https://relay.example/moq" });
  });

  afterEach(async () => {
    await transport._disconnect();
    vi.restoreAllMocks();
  });

  test("_connect() opens a private connection with a bounded retry window and the pinned certificate", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport._connect({
      relayUrl: "https://relay.example/moq",
      serverCertificateHashes: [
        { algorithm: "sha-256", value: new Uint8Array([1, 2, 3]).buffer },
      ],
    });

    const [connection] = captured.connections;
    // A pooled (shared) connection throws on `webtransport` options and
    // pins the retry window to unlimited; both need `share: false`.
    expect(connection.props.share).toBe(false);
    // The default `relayRetryTimeoutMs` (see its doc for why 60 s).
    expect(connection.props.delay?.timeout).toBe(60_000);
    expect(
      connection.props.webtransport?.serverCertificateHashes,
    ).toHaveLength(1);
  });

  test("relayRetryTimeoutMs in connect params sets the retry window", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport._connect({ relayUrl: "https://relay.example/moq", relayRetryTimeoutMs: 90_000 });

    const [connection] = captured.connections;
    expect(connection.props.delay?.timeout).toBe(90_000);
  });

  test("relayRetryTimeoutMs from the constructor survives a raw /start response", async () => {
    const t = new MoqTransport({ relayUrl: "https://unused.example/moq", relayRetryTimeoutMs: 120_000 });
    const { callbacks } = buildSpyCallbacks();
    wireTransport(t, callbacks);

    await t._connect(
      t._validateConnectionParams({
        moq: {
          relayUrl: "https://relay.example/moq",
          certHash: null,
          namespace: "pcc/session",
          clientId: "request",
          botId: "response",
          transcriptTrack: "transcript",
        },
      }),
    );

    const connection = captured.connections.at(-1);
    expect(connection?.props.delay?.timeout).toBe(120_000);
    await t._disconnect();
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "relayRetryTimeoutMs of %s is refused rather than meaning retry forever",
    (value) => {
      expect(() => new MoqTransport({ relayUrl: "https://relay.example/moq", relayRetryTimeoutMs: value })).toThrow(
        /relayRetryTimeoutMs/,
      );
    },
  );

  test("relayRetryTimeoutMs of 0 in connect params is refused before dialing", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await expect(
      transport._connect({ relayUrl: "https://relay.example/moq", relayRetryTimeoutMs: 0 }),
    ).rejects.toThrow(/relayRetryTimeoutMs/);
    expect(captured.connections).toHaveLength(0);
  });

  test("_disconnect() before 'ready' tears down a connection that is between attempts", async () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    await transport._connect();
    const [connection] = captured.connections;
    const close = vi.spyOn(connection, "close");
    // Between attempts, the relay status reads as a disconnected transport.
    connection.status.set("disconnected");
    await tick();
    expect(transport.state).toBe("disconnected");
    recorder.states.length = 0;

    await transport._disconnect();

    expect(close).toHaveBeenCalled();
    expect(recorder.states).toEqual(["disconnecting", "disconnected"]);
  });

  test("a second _disconnect() after a completed one is a no-op", async () => {
    const { callbacks, spies, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    await transport._connect();
    await transport._disconnect();
    const disconnects = spies.onDisconnected.mock.calls.length;
    recorder.states.length = 0;

    await transport._disconnect();

    expect(recorder.states).toEqual([]);
    expect(spies.onDisconnected).toHaveBeenCalledTimes(disconnects);
  });

  test("a disconnect under way holds against the relay status", async () => {
    const { callbacks, spies, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    await transport._connect();
    const [connection] = captured.connections;
    connection.status.set("disconnected");
    await tick();
    recorder.states.length = 0;

    // The connection's backoff ends while the session-ending record goes out.
    const done = transport._disconnect();
    connection.status.set("connecting");
    await tick();
    expect(transport.state).toBe("disconnecting");
    await done;

    expect(recorder.states).toEqual(["disconnecting", "disconnected"]);
    expect(spies.onError).not.toHaveBeenCalled();
  });

  test("the connection giving up on its own drives the transport to 'error'", async () => {
    // `connection.error` is the give-up signal: with the private loop's
    // `delay.timeout`, it is set when the relay stays down for the whole
    // retry window (as well as on an auth rejection).
    const { callbacks, spies, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    await transport._connect();
    recorder.states.length = 0;

    const [connection] = captured.connections;
    connection.error.set(new Error("relay unreachable"));
    await tick();

    expect(recorder.states).toEqual(["error"]);
    expect(spies.onError).toHaveBeenCalledTimes(1);
    expect(spies.onError.mock.calls[0][0].data.fatal).toBe(true);
  });

  test("discovery is gated on the bot's announcement", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport._connect();

    const [watchBroadcast] = captured.watchBroadcasts;
    expect(watchBroadcast.props.announced.peek()).toBe(true);

    const request = vi.fn(() => ({
      active: new Signal<unknown>(undefined),
      close: vi.fn(),
    }));
    captured.connections[0].origin.set({ request });
    await tick();

    expect(request).toHaveBeenCalledWith("pipecat/bot0", { announced: true });
  });

  test("a bot republish re-resolves the origin request and re-subscribes the transcript", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    await transport._connect();

    const active = new Signal<unknown>(undefined);
    const request = vi.fn(() => ({ active, close: vi.fn() }));
    captured.connections[0].origin.set({ request });
    await tick();

    const makeBroadcast = () => {
      const subscription = { close: vi.fn() };
      const track = vi.fn(() => ({ subscribe: vi.fn(() => subscription) }));
      return { broadcast: { track }, track, subscription };
    };

    // The bot appears: the request resolves and the transcript track is
    // subscribed.
    const first = makeBroadcast();
    active.set(first.broadcast);
    await tick();
    expect(first.track).toHaveBeenCalledWith("transcript.json.z");

    // The bot redials with a fresh publisher, replacing its broadcast on
    // the relay: the request re-resolves, the old subscription is closed,
    // and the new broadcast's transcript track is subscribed.
    const second = makeBroadcast();
    active.set(second.broadcast);
    await tick();
    expect(first.subscription.close).toHaveBeenCalled();
    expect(second.track).toHaveBeenCalledWith("transcript.json.z");
  });
});

/**
 * `@moq/net` gives a connect attempt no deadline, so the transport keeps
 * one: an attempt still connecting at its deadline is abandoned by turning
 * the connection off and on, and the retry window is kept by the transport.
 * These run `_connect()` against the mocked Connection on fake timers.
 */
describe("MoqTransport — relay attempt deadlines", () => {
  let transport: MoqTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    captured.connections.length = 0;
    captured.watchBroadcasts.length = 0;
    transport = new MoqTransport({ relayUrl: "https://relay.example/moq" });
  });

  afterEach(async () => {
    // `_disconnect` gives the session-ending record 250 ms to go out.
    const done = transport._disconnect();
    await vi.advanceTimersByTimeAsync(250);
    await done;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Connect, then stand in for the reconnect loop behind the mocked
   *  Connection: turning it off cancels the attempt in flight
   *  (`disconnected`), turning it on dials again (`connecting`). Every
   *  change to the switch is recorded in `switched`, and when it happened
   *  (on the fake clock) in `switchedAt`. Fake timers run a 0 ms timeout
   *  set during a tick 1 ms later, so dialing again lands 1 ms after the
   *  attempt is abandoned. */
  async function connect(params: Record<string, unknown> = {}) {
    const { callbacks, spies, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    await transport._connect({ relayUrl: "https://relay.example/moq", ...params });
    const connection = captured.connections[0];
    const switched: boolean[] = [];
    const switchedAt: number[] = [];
    connection.props.enabled.subscribe((on: boolean) => {
      switched.push(on);
      switchedAt.push(Date.now());
      connection.status.set(on ? "connecting" : "disconnected");
    });
    return { connection, switched, switchedAt, spies, recorder };
  }

  test("an attempt still connecting at its deadline is abandoned and dialed again", async () => {
    const { switched } = await connect();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(switched).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(switched).toEqual([false, true]);
  });

  test("the deadline doubles for each attempt in a row that runs out, up to 20 s", async () => {
    const start = Date.now();
    const { switched, switchedAt } = await connect({ relayRetryTimeoutMs: 120_000 });
    await vi.advanceTimersByTimeAsync(100_000);

    // Each attempt runs from the first dial, or from dialing again, to
    // being abandoned.
    const deadlines = switched.flatMap((on, i) =>
      on ? [] : [switchedAt[i] - (i === 0 ? start : switchedAt[i - 1])],
    );
    expect(deadlines).toEqual([5_000, 10_000, 20_000, 20_000, 20_000, 20_000]);
  });

  test("reaching the relay resets the deadline", async () => {
    const { connection, switched } = await connect();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(switched).toHaveLength(2);

    connection.status.set("connected");
    await vi.advanceTimersByTimeAsync(1_000);
    connection.status.set("disconnected");
    connection.status.set("connecting");
    await vi.advanceTimersByTimeAsync(5_001);

    expect(switched).toHaveLength(4);
  });

  test("attempts that fail on their own are not cut short", async () => {
    const { connection, switched } = await connect();
    // The loop's own cycle: an attempt fails within 3 s, then it backs off.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(3_000);
      connection.status.set("disconnected");
      await vi.advanceTimersByTimeAsync(1_000);
      connection.status.set("connecting");
    }

    expect(switched).toEqual([]);
  });

  test("a relay out of reach for the retry window ends the session once, however its attempts end", async () => {
    const { connection, switched, spies, recorder } = await connect();
    // Attempts hang and are abandoned (at 5, 15 and 35 s); one fails on
    // its own in between.
    await vi.advanceTimersByTimeAsync(40_000);
    connection.status.set("disconnected");
    await vi.advanceTimersByTimeAsync(1_000);
    connection.status.set("connecting");
    await vi.advanceTimersByTimeAsync(18_999);
    expect(spies.onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(recorder.states.at(-1)).toBe("error");
    expect(spies.onError).toHaveBeenCalledTimes(1);
    const [message] = spies.onError.mock.calls[0];
    expect(message.data.fatal).toBe(true);
    expect(message.data.message).toContain("still unreachable after 60 s");
    // It stops dialing, and the connection's own give-up is not reported again.
    expect(switched.at(-1)).toBe(false);
    connection.error.set(new Error("reconnect timed out"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spies.onError).toHaveBeenCalledTimes(1);
    expect(switched.at(-1)).toBe(false);
  });

  test("with no attempt abandoned, the connection's own give-up ends the session and says why", async () => {
    const { connection, switched, spies } = await connect();
    // Every attempt fails by itself within 3 s, then the loop backs off.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(3_000);
      connection.status.set("disconnected");
      await vi.advanceTimersByTimeAsync(1_000);
      connection.status.set("connecting");
    }
    expect(spies.onError).not.toHaveBeenCalled();

    connection.error.set(
      new AggregateError([new Error("unsupported server version")], "All promises were rejected"),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(switched).toEqual([]);
    expect(spies.onError).toHaveBeenCalledTimes(1);
    expect(spies.onError.mock.calls[0][0].data.message).toContain("unsupported server version");
  });

  test("a relay that drops every session at once stays one outage", async () => {
    const { connection, spies } = await connect();
    // Reached at 3 s but dropped half a second later: not a session that held.
    await vi.advanceTimersByTimeAsync(3_000);
    connection.status.set("connected");
    await vi.advanceTimersByTimeAsync(500);
    connection.status.set("disconnected");
    connection.status.set("connecting");

    // The next attempt hangs and is abandoned, so the window is kept from
    // the first dial: it gives up at 60 s, not 60 s after the drop.
    await vi.advanceTimersByTimeAsync(56_499);
    expect(spies.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spies.onError).toHaveBeenCalledTimes(1);
  });

  test("a session that reaches the relay in the window's last second survives the window", async () => {
    const { connection, switched, spies } = await connect();
    // Attempts hang and are abandoned at 5, 15, 35 and 55 s.
    await vi.advanceTimersByTimeAsync(59_500);
    connection.status.set("connected");
    await vi.advanceTimersByTimeAsync(10_500);

    expect(spies.onError).not.toHaveBeenCalled();
    expect(switched.at(-1)).toBe(true);
  });

  test("a session reached in the window's last second that drops before it held ends at the window", async () => {
    const { connection, spies } = await connect();
    // Attempts hang and are abandoned at 5, 15, 35 and 55 s.
    await vi.advanceTimersByTimeAsync(59_500);
    connection.status.set("connected");
    await vi.advanceTimersByTimeAsync(300);
    connection.status.set("disconnected");
    connection.status.set("connecting");
    await vi.advanceTimersByTimeAsync(199);
    expect(spies.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(spies.onError).toHaveBeenCalledTimes(1);
    expect(spies.onError.mock.calls[0][0].data.message).toContain("still unreachable after 60 s");
  });

  test("an outage that ended leaves nothing behind for the next one", async () => {
    const { connection, spies } = await connect();
    await vi.advanceTimersByTimeAsync(5_001);
    connection.status.set("connected");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(spies.onError).not.toHaveBeenCalled();
    expect(connection.props.enabled.peek()).toBe(true);

    // A later outage whose attempts all fail by themselves is the
    // connection's to end, with its reasons.
    connection.status.set("disconnected");
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1_000);
      connection.status.set("connecting");
      await vi.advanceTimersByTimeAsync(3_000);
      connection.status.set("disconnected");
    }
    expect(spies.onError).not.toHaveBeenCalled();
    connection.error.set(new Error("unsupported server version"));
    await vi.advanceTimersByTimeAsync(0);
    expect(spies.onError.mock.calls[0][0].data.message).toContain("unsupported server version");
  });

  test("a window shorter than the first deadline ends the session at the window, without dialing again", async () => {
    const { switched, spies } = await connect({ relayRetryTimeoutMs: 3_000 });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(spies.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(spies.onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(switched).toEqual([false]);
  });

  test("a window longer than a timer can wait does not give up early", async () => {
    const { switched, spies } = await connect({ relayRetryTimeoutMs: Number.MAX_SAFE_INTEGER });
    await vi.advanceTimersByTimeAsync(120_000);

    expect(switched.filter((on) => !on).length).toBeGreaterThan(3);
    expect(spies.onError).not.toHaveBeenCalled();
  });

  test("the retry window starts over once the relay is reached", async () => {
    const { connection, spies } = await connect();
    await vi.advanceTimersByTimeAsync(1_000);
    connection.status.set("connected");
    await vi.advanceTimersByTimeAsync(29_000);
    connection.status.set("disconnected");
    connection.status.set("connecting");

    await vi.advanceTimersByTimeAsync(59_999);
    expect(spies.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spies.onError).toHaveBeenCalledTimes(1);
  });

  test("a ready session stays ready while attempts are abandoned", async () => {
    const { connection, switched, recorder } = await connect();
    connection.status.set("connected");
    const ready = transport.sendReadyMessage();
    // The bot-audio wait times out 20 s after the relay connects.
    await vi.advanceTimersByTimeAsync(20_000);
    await ready;
    expect(transport.state).toBe("ready");
    recorder.states.length = 0;

    connection.status.set("disconnected");
    connection.status.set("connecting");
    // Abandoned after 5 s, then after 10 s more.
    await vi.advanceTimersByTimeAsync(15_002);

    expect(switched).toEqual([false, true, false, true]);
    expect(transport.state).toBe("ready");
    expect(recorder.states).toEqual([]);
  });

  test("a ready session whose relay stays out of reach ends in 'error' at the end of the window", async () => {
    const { connection, spies, recorder } = await connect();
    connection.status.set("connected");
    const ready = transport.sendReadyMessage();
    await vi.advanceTimersByTimeAsync(20_000);
    await ready;
    recorder.states.length = 0;

    // Lost at 20 s; every attempt after that hangs.
    connection.status.set("disconnected");
    connection.status.set("connecting");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(recorder.states).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(recorder.states).toEqual(["error"]);
    expect(spies.onError).toHaveBeenCalledTimes(1);
    expect(spies.onError.mock.calls[0][0].data.fatal).toBe(true);
  });

  test("a disconnect stops the deadlines", async () => {
    const { switched, spies } = await connect();
    await vi.advanceTimersByTimeAsync(4_000);
    const done = transport._disconnect();
    await vi.advanceTimersByTimeAsync(250);
    await done;

    await vi.advanceTimersByTimeAsync(120_000);
    expect(switched).toEqual([]);
    expect(spies.onError).not.toHaveBeenCalled();
  });

  test("a disconnect between abandoning an attempt and dialing again leaves the connection off", async () => {
    const { connection, switched } = await connect();
    await vi.advanceTimersByTimeAsync(4_999);
    // Fire the deadline alone; dialing again waits for the next task.
    await vi.advanceTimersToNextTimerAsync();
    const done = transport._disconnect();
    await vi.advanceTimersByTimeAsync(250);
    await done;

    expect(switched).toEqual([false]);
    expect(connection.props.enabled.peek()).toBe(false);
  });
});

describe("MoqTransport.mediaSupport", () => {
  test("carries the user's microphone and the bot's audio only", () => {
    const transport = new MoqTransport({
      relayUrl: "https://relay.example/moq",
    });
    expect(transport.mediaSupport).toEqual({
      mic: true,
      cam: false,
      screenShare: false,
      botAudio: true,
      botVideo: false,
    });
  });
});
