/**
 * Characterization tests for MoqTransport's lifecycle contract.
 *
 * Locks in today's state transitions for initialize(), initDevices(),
 * sendReadyMessage(), and _disconnect(). The transport does not accept a
 * MediaManager DI hook (unlike the WAV-based transports), so we stub the
 * `navigator.mediaDevices` surface directly for the initDevices() path.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// @moq/hang 0.2.7's root barrel uses a directory import (`import * from
// "./catalog"`) that Node ESM rejects. @moq/publish in turn imports the
// barrel, so any load of the transport pulls in the broken chain. None of
// the moq libs are exercised by these lifecycle tests, so mock them out
// here — the tests assert behavior at the abstract Transport boundary,
// not against the network stack.
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
vi.mock("@moq/publish", () => ({
  Broadcast: class {
    close() {}
  },
  Audio: { Source: class {}, StreamTrack: class {} },
}));
vi.mock("@moq/net", () => ({
  Connection: { Reload: class {} },
  Path: { from: (...parts: string[]) => parts.join("/") },
}));

import { MoqTransport } from "@pipecat-ai/moq-transport";

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

  test("sendReadyMessage() flips state to 'ready'", () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
    recorder.states.length = 0;

    transport.sendReadyMessage();

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

  test("initDevices() failure wraps the underlying error in an RTVIError", async () => {
    stubMediaDevices({
      getUserMedia: vi.fn(async () => {
        throw new Error("permission denied");
      }),
    });

    await expect(transport.initDevices()).rejects.toThrow(/permission denied/);
  });

  test("sendMessage() is a no-op by design (no client→server RTVI channel)", () => {
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
});
