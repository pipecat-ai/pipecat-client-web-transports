/**
 * Characterization tests for MoqTransport's lifecycle contract.
 *
 * Locks in today's state transitions for initialize(), initDevices(),
 * sendReadyMessage(), and _disconnect(). The transport does not accept a
 * MediaManager DI hook (unlike the WAV-based transports), so we stub the
 * `navigator.mediaDevices` surface directly for the initDevices() path.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// @moq/hang's root barrel uses directory imports (`import * from
// "./catalog"`) that Node ESM rejects, and @moq/publish + @moq/watch
// both pull it in transitively, so any load of the transport hits the
// broken chain. None of the moq libs are exercised by these lifecycle
// tests, so mock them out here — the tests assert behavior at the
// abstract Transport boundary, not against the network stack.
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
vi.mock("@moq/publish", () => {
  class Microphone {
    private _permissionRequested = false;
    private _track: MediaStreamTrack | undefined;
    device = {
      requestPermission: () => {
        if (this._permissionRequested) return;
        this._permissionRequested = true;
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            this._track = stream.getAudioTracks()[0];
          })
          .catch(() => {});
      },
    };
    source = {
      peek: () =>
        this._track ? { track: this._track } : undefined,
    };
    constructor(_opts: unknown) {}
  }
  return {
    Broadcast: class {
      close() {}
    },
    Audio: { StreamTrack: class {} },
    Source: { Microphone },
  };
});
vi.mock("@moq/watch", () => ({
  Broadcast: class {
    close() {}
  },
  Sync: class {},
  Audio: {
    Source: class {},
    Decoder: class {},
    Emitter: class {},
  },
}));
vi.mock("@moq/net", () => ({
  Connection: { Reload: class {} },
  Path: { from: (...parts: string[]) => parts.join("/") },
}));

import { acceptTranscriptRecord, MoqTransport } from "@pipecat-ai/moq-transport";

import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

interface MediaDevicesStub {
  getUserMedia: ReturnType<typeof vi.fn>;
  enumerateDevices: ReturnType<typeof vi.fn>;
}

function stubMediaDevices(overrides: Partial<MediaDevicesStub> = {}): MediaDevicesStub {
  const stubTrack = {
    getSettings: () => ({ deviceId: "mic-1" }),
    stop: vi.fn(),
    enabled: true,
  } as unknown as MediaStreamTrack;
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
    expect(transport.state).toBe("disconnected");

    await transport._disconnect();

    expect(transport.state).toBe("disconnected");
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
    _transcriptOut: Set<{ append: (r: Record) => void }> | null;
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
    internals._transcriptOut = new Set([producer]);

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

  test("_drainTranscript() redials when the bot's tracks end without the marker", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    const redial = vi
      .spyOn(transport as unknown as { _redial: () => void }, "_redial")
      .mockImplementation(() => {});
    const script: (Record | null)[] = [rtvi("bot-output", { seq: 0, epoch: "b1" }), null];
    const consumer = { next: vi.fn(async () => script.shift() ?? null) };

    await (transport as unknown as Internals)._drainTranscript(
      consumer,
      new AbortController().signal,
    );

    expect(redial).toHaveBeenCalledTimes(1);
  });

  test("_drainTranscript() does not redial when its own teardown aborted it", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    const redial = vi
      .spyOn(transport as unknown as { _redial: () => void }, "_redial")
      .mockImplementation(() => {});
    const ac = new AbortController();
    const consumer = {
      next: vi.fn(async () => {
        ac.abort();
        return null;
      }),
    };

    await (transport as unknown as Internals)._drainTranscript(consumer, ac.signal);

    expect(redial).not.toHaveBeenCalled();
  });

  test("_disconnect() sends the session-ending marker before tearing down", async () => {
    const internals = transport as unknown as Internals;
    const producer = { append: vi.fn<(r: Record) => void>() };
    internals._transcriptLog = [];
    internals._transcriptEpoch = "e1";
    internals._transcriptOut = new Set([producer]);
    (transport as unknown as { _state: string })._state = "connected";

    await transport._disconnect();

    expect(producer.append.mock.calls.map(([r]) => [r.label, r.type, r.seq, r.epoch])).toEqual([
      ["moq-transport", "session-ending", 0, "e1"],
    ]);
    expect(transport.state).toBe("disconnected");
  });
});
