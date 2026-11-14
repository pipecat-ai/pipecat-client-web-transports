/**
 * WavStreamPlayer interrupt contract: the player behind bot audio on the
 * WebSocket transport (via either media manager).
 *
 * The Web Audio pieces are faked: happy-dom has no AudioContext or
 * AudioWorkletNode. The fake node stands in for the stream_processor worklet
 * on the other side of the port and answers its message protocol.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@daily-co/daily-js", () => ({
  default: { getCallInstance: () => undefined, createCallObject: () => null },
}));

const { WavStreamPlayer } = await import("@pipecat-ai/transport-lib");

type PortMessage = { data: Record<string, unknown> };

/** One stream_processor node, as the player sees it through its port. */
class FakeWorkletNode {
  static created: FakeWorkletNode[] = [];

  /** Chunks written to this node, in order. */
  writes: Array<{ trackId: string; length: number }> = [];
  interrupted = false;
  connect = vi.fn();
  disconnect = vi.fn();
  port: {
    onmessage: ((e: PortMessage) => void) | null;
    postMessage: (msg: Record<string, unknown>) => void;
  };

  constructor() {
    FakeWorkletNode.created.push(this);
    this.port = {
      onmessage: null,
      postMessage: (msg) => this.#handle(msg),
    };
  }

  /** What the worklet does with each message from the player. */
  #handle(msg: Record<string, unknown>) {
    if (msg.event === "write") {
      const buffer = msg.buffer as Int16Array;
      this.writes.push({
        trackId: msg.trackId as string,
        length: buffer.length,
      });
    } else if (msg.event === "offset" || msg.event === "interrupt") {
      const trackId = this.writes[this.writes.length - 1]?.trackId ?? null;
      const offset = this.writes
        .filter((w) => w.trackId === trackId)
        .reduce((n, w) => n + w.length, 0);
      if (msg.event === "interrupt") this.interrupted = true;
      // The worklet answers on its next turn, never synchronously.
      queueMicrotask(() =>
        this.port.onmessage?.({
          data: { event: "offset", requestId: msg.requestId, trackId, offset },
        })
      );
    }
  }

  /** The worklet's own "stop" once its render loop has ended. */
  stop() {
    this.port.onmessage?.({ data: { event: "stop" } });
  }
}

class FakeAudioContext {
  state = "running";
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  resume = vi.fn(async () => {});
  setSinkId = vi.fn(async () => {});
  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
}

const chunk = () => new Int16Array(256);

describe("WavStreamPlayer interrupt", () => {
  let player: InstanceType<typeof WavStreamPlayer>;

  beforeEach(async () => {
    FakeWorkletNode.created = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    player = new WavStreamPlayer({ sampleRate: 24000 });
    await player.connect();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reports the offset of the playing track and stops the stream", async () => {
    player.add16BitPCM(chunk());
    player.add16BitPCM(chunk());

    const result = await player.interrupt();

    expect(result).toEqual({
      trackId: "default",
      offset: 512,
      currentTime: 512 / 24000,
    });
    expect(FakeWorkletNode.created[0].interrupted).toBe(true);
  });

  test("untagged audio added after an interrupt plays on a new stream", async () => {
    player.add16BitPCM(chunk());
    await player.interrupt();

    const queued = player.add16BitPCM(chunk());

    expect(queued).toBeInstanceOf(Int16Array);
    expect(FakeWorkletNode.created).toHaveLength(2);
    expect(FakeWorkletNode.created[1].writes).toEqual([
      { trackId: "default", length: 256 },
    ]);
  });

  test("untagged audio still plays after an interrupt followed by a reconnect", async () => {
    // What both media managers do on disconnect() then connect().
    player.add16BitPCM(chunk());
    await player.interrupt();
    await player.connect();

    expect(player.add16BitPCM(chunk())).toBeInstanceOf(Int16Array);
    expect(FakeWorkletNode.created).toHaveLength(2);
  });

  test("audio survives any number of interrupts", async () => {
    for (let i = 0; i < 3; i++) {
      player.add16BitPCM(chunk());
      await player.interrupt();
    }

    expect(player.add16BitPCM(chunk())).toBeInstanceOf(Int16Array);
    expect(FakeWorkletNode.created).toHaveLength(4);
  });

  test("the rest of an explicitly tagged track is dropped once it is interrupted, and the next tagged track plays", async () => {
    player.add16BitPCM(chunk(), "utterance-1");
    await player.interrupt();

    expect(player.add16BitPCM(chunk(), "utterance-1")).toBeUndefined();
    expect(FakeWorkletNode.created).toHaveLength(1);

    expect(player.add16BitPCM(chunk(), "utterance-2")).toBeInstanceOf(
      Int16Array
    );
    expect(FakeWorkletNode.created[1].writes).toEqual([
      { trackId: "utterance-2", length: 256 },
    ]);
  });

  test("the interrupted stream's late 'stop' does not take down the stream that replaced it", async () => {
    player.add16BitPCM(chunk());
    await player.interrupt();
    player.add16BitPCM(chunk());
    const [first, second] = FakeWorkletNode.created;

    first.stop();
    player.add16BitPCM(chunk());

    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(FakeWorkletNode.created).toHaveLength(2);
    expect(second.writes).toHaveLength(2);
  });

  test("a stream that ends on its own is released, and the next chunk starts a new one", async () => {
    player.add16BitPCM(chunk());
    FakeWorkletNode.created[0].stop();

    player.add16BitPCM(chunk());

    expect(FakeWorkletNode.created).toHaveLength(2);
  });

  test("interrupt() with nothing playing is a no-op", async () => {
    expect(await player.interrupt()).toBeNull();
    expect(FakeWorkletNode.created).toHaveLength(0);
  });
});
