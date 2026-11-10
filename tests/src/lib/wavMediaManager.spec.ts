/**
 * WavMediaManager enableMic / connect contract (the media manager behind
 * the WebSocket transport's raw-audio mode, and others that take it by DI).
 *
 * The recorder and player are replaced with fakes: the real ones drive
 * getUserMedia and AudioContext, neither of which happy-dom provides.
 */

import type { PipecatClientOptions } from "@pipecat-ai/client-js";
import { WavMediaManager } from "@pipecat-ai/transport-lib";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { buildSpyCallbacks } from "../helpers/observeTransport";

type DeviceErrorListener = (e: {
  devices: Array<"cam" | "mic">;
  type: string;
  error?: Error;
}) => void;

function createFakeRecorder() {
  const track = { enabled: true } as MediaStreamTrack;
  const rec = {
    stream: null as null | { getAudioTracks: () => MediaStreamTrack[] },
    recording: false,
    deviceSelection: null,
    beginCalls: 0,
    beginShouldFail: false,
    errorListener: null as null | DeviceErrorListener,
    begin: vi.fn(async () => {
      rec.beginCalls += 1;
      if (rec.beginShouldFail) {
        // Mirrors WavRecorder.begin(): report via the listener, then throw.
        rec.errorListener?.({ devices: ["mic"], type: "unknown" });
        throw new Error("Could not start media stream");
      }
      rec.stream = { getAudioTracks: () => [track] };
    }),
    record: vi.fn(async () => {
      rec.recording = true;
    }),
    pause: vi.fn(async () => {
      rec.recording = false;
    }),
    end: vi.fn(async () => {
      rec.stream = null;
      rec.recording = false;
    }),
    getStatus: () =>
      !rec.stream ? "ended" : rec.recording ? "recording" : "paused",
    listenForDeviceChange: vi.fn(),
    listenForDeviceErrors: vi.fn((cb: DeviceErrorListener | null) => {
      rec.errorListener = cb;
    }),
    listDevices: vi.fn(async () => []),
    track,
  };
  return rec;
}

describe("WavMediaManager", () => {
  let manager: WavMediaManager;
  let recorder: ReturnType<typeof createFakeRecorder>;
  let spies: ReturnType<typeof buildSpyCallbacks>["spies"];

  function build(opts: Partial<PipecatClientOptions> = {}) {
    manager = new WavMediaManager();
    recorder = createFakeRecorder();
    const internals = manager as unknown as {
      _wavRecorder: unknown;
      _wavStreamPlayer: unknown;
    };
    internals._wavRecorder = recorder;
    internals._wavStreamPlayer = {
      connect: vi.fn(async () => {}),
      interrupt: vi.fn(async () => {}),
    };
    const built = buildSpyCallbacks();
    spies = built.spies;
    manager.setClientOptions({
      transport: {} as never,
      callbacks: built.callbacks,
      ...opts,
    } as PipecatClientOptions);
  }

  beforeEach(() => build());

  test("pre-session enableMic(false) with nothing acquired records the preference only", async () => {
    await manager.enableMic(false);

    expect(recorder.begin).not.toHaveBeenCalled();
    expect(manager.isMicEnabled).toBe(false);
  });

  test("pre-session enableMic(true) acquires the mic and reports the track, without recording", async () => {
    build({ enableMic: false });

    await manager.enableMic(true);

    expect(recorder.beginCalls).toBe(1);
    expect(spies.onTrackStarted).toHaveBeenCalledWith(
      recorder.track,
      expect.objectContaining({ local: true })
    );
    expect(recorder.record).not.toHaveBeenCalled();
    expect(manager.isMicEnabled).toBe(true);
  });

  test("initialize() with the mic off does not acquire it", async () => {
    build({ enableMic: false });

    await manager.initialize();

    expect(recorder.begin).not.toHaveBeenCalled();
  });

  test("initialize() is idempotent", async () => {
    await manager.initialize();
    await manager.initialize();

    expect(recorder.beginCalls).toBe(1);
  });

  test("a mic that fails to acquire on initialize() is reported as a DeviceError, and enableMic(true) re-attempts", async () => {
    recorder.beginShouldFail = true;

    await manager.initialize();

    expect(spies.onDeviceError).toHaveBeenCalledTimes(1);
    expect(spies.onDeviceError.mock.calls[0][0].devices).toEqual(["mic"]);

    recorder.beginShouldFail = false;
    await manager.enableMic(true);

    expect(recorder.beginCalls).toBe(2);
    expect(spies.onTrackStarted).toHaveBeenCalledTimes(1);
  });

  test("connect() acquires and records when the mic is on, and leaves a mic acquired pre-connect as it is", async () => {
    await manager.enableMic(true);
    expect(recorder.beginCalls).toBe(1);

    await manager.connect();

    expect(recorder.beginCalls).toBe(1);
    expect(recorder.record).toHaveBeenCalledTimes(1);
  });

  test("connect() with the mic off neither acquires nor records", async () => {
    build({ enableMic: false });

    await manager.connect();

    expect(recorder.begin).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
  });

  test("a mid-session toggle is live only: disconnect() resets to the connect-time flag and the next connect() acquires from it", async () => {
    await manager.connect();

    await manager.enableMic(false);
    expect(recorder.pause).toHaveBeenCalledTimes(1);
    expect(spies.onTrackStopped).toHaveBeenCalledTimes(1);
    expect(manager.isMicEnabled).toBe(false);

    await manager.disconnect();
    expect(recorder.end).toHaveBeenCalledTimes(1);
    expect(manager.isMicEnabled).toBe(true);

    await manager.connect();

    expect(recorder.beginCalls).toBe(2);
    expect(recorder.record).toHaveBeenCalledTimes(2);
  });

  test("a toggle between sessions updates the connect-time flag, so the next connect() does not acquire", async () => {
    await manager.connect();
    await manager.disconnect();

    await manager.enableMic(false);
    await manager.connect();

    expect(recorder.beginCalls).toBe(1);
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(manager.isMicEnabled).toBe(false);
  });

  test("enableMic(true) after connect() with the mic off acquires the mic, reports the track to the client and the transport, and records", async () => {
    build({ enableMic: false });
    const transportTrackStarted = vi.fn();
    manager.registerTrackCallbacks(transportTrackStarted, vi.fn());
    await manager.connect();
    expect(recorder.begin).not.toHaveBeenCalled();

    await manager.enableMic(true);

    expect(recorder.beginCalls).toBe(1);
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(spies.onTrackStarted).toHaveBeenCalledWith(
      recorder.track,
      expect.objectContaining({ local: true })
    );
    expect(transportTrackStarted).toHaveBeenCalledWith(recorder.track, "audio");
  });

  test("enableMic(false) reports the stopped track to the client and the transport", async () => {
    const transportTrackStopped = vi.fn();
    manager.registerTrackCallbacks(vi.fn(), transportTrackStopped);
    await manager.connect();

    await manager.enableMic(false);

    expect(spies.onTrackStopped).toHaveBeenCalledWith(
      recorder.track,
      expect.objectContaining({ local: true })
    );
    expect(transportTrackStopped).toHaveBeenCalledWith(recorder.track, "audio");
  });

  test("enableMic(true) during a session re-enables the track and resumes recording", async () => {
    await manager.connect();
    await manager.enableMic(false);

    await manager.enableMic(true);

    expect(recorder.track.enabled).toBe(true);
    expect(recorder.record).toHaveBeenCalledTimes(2);
    expect(spies.onTrackStarted).toHaveBeenCalledTimes(2);
  });

  test("disconnect() after a failed acquisition does not try to end a recorder that never began", async () => {
    recorder.beginShouldFail = true;
    await manager.connect();

    await expect(manager.disconnect()).resolves.toBeUndefined();
    expect(recorder.end).not.toHaveBeenCalled();
  });
});
