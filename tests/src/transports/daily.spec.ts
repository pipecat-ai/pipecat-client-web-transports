/**
 * Characterization tests for DailyTransport's initDevices() contract.
 *
 * Locks in today's behavior ahead of Plan A step 2. Unlike the DI-friendly
 * transports, DailyTransport instantiates the daily-js call object eagerly in
 * its constructor, so we mock the whole module via vi.mock().
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  createFakeDailyCallObject,
  type FakeDailyCallObject,
} from "../helpers/fakeDaily";
import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

// Module-scoped handle the mock can refer to. Each test assigns a fresh fake
// before constructing the transport.
let currentFakeDaily: FakeDailyCallObject | null = null;

vi.mock("@daily-co/daily-js", () => ({
  default: {
    createCallObject: () => currentFakeDaily,
  },
}));

// Import AFTER the mock is registered so the module picks up the stub.
const { DailyTransport } = await import("@pipecat-ai/daily-transport");

describe("DailyTransport.initDevices() — characterization", () => {
  let fakeDaily: FakeDailyCallObject;
  let transport: InstanceType<typeof DailyTransport>;

  beforeEach(() => {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    transport = new DailyTransport();
  });

  test("initial state after construction is 'disconnected'", () => {
    expect(transport.state).toBe("disconnected");
  });

  test("happy-path initDevices(): disconnected → initializing → initialized", async () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();

    expect(fakeDaily.startCameraCallCount).toBe(1);
    expect(transport.state).toBe("initialized");
    expect(recorder.states).toEqual(["initializing", "initialized"]);
  });

  test("initDevices() fans out available-device + selected-device callbacks exactly once", async () => {
    const { callbacks, spies } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();

    // Available-device lists (even if empty — the callback itself fires).
    expect(spies.onAvailableCamsUpdated).toHaveBeenCalledTimes(1);
    expect(spies.onAvailableMicsUpdated).toHaveBeenCalledTimes(1);
    expect(spies.onAvailableSpeakersUpdated).toHaveBeenCalledTimes(1);
    // Selected-device info derived from startCamera's return value.
    expect(spies.onCamUpdated).toHaveBeenCalledTimes(1);
    expect(spies.onMicUpdated).toHaveBeenCalledTimes(1);
    expect(spies.onSpeakerUpdated).toHaveBeenCalledTimes(1);
  });

  test("repeated initDevices() calls re-invoke startCamera and re-emit state transitions", async () => {
    // Today DailyTransport is NOT idempotent: a second call re-runs the full
    // startCamera/enumerate flow. Step 2 introduces a MediaState gate that
    // short-circuits repeat calls at the PipecatClient layer.
    const { callbacks, recorder, spies } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();
    await transport.initDevices();

    expect(fakeDaily.startCameraCallCount).toBe(2);
    expect(transport.state).toBe("initialized");
    expect(recorder.states).toEqual([
      "initializing",
      "initialized",
      "initializing",
      "initialized",
    ]);
    // Device callbacks fire twice as well — consumers see duplicate updates.
    expect(spies.onMicUpdated).toHaveBeenCalledTimes(2);
    expect(spies.onCamUpdated).toHaveBeenCalledTimes(2);
  });

  test("second initDevices() does NOT restart audio observers (partial internal idempotency)", async () => {
    // The one place DailyTransport guards against repeats is the audio-level
    // observers: it checks isLocalAudioLevelObserverRunning() before starting
    // them. This partial idempotency is what step 2 should preserve when it
    // short-circuits repeat initDevices calls.
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();

    // First call sees both observers as not running and starts them. Flip
    // the fakes so the second call sees "already running".
    fakeDaily.isLocalAudioLevelObserverRunning.mockReturnValue(true);
    fakeDaily.isRemoteParticipantsAudioLevelObserverRunning.mockReturnValue(
      true
    );

    await transport.initDevices();

    expect(fakeDaily.startLocalAudioLevelObserver).toHaveBeenCalledTimes(1);
    expect(
      fakeDaily.startRemoteParticipantsAudioLevelObserver
    ).toHaveBeenCalledTimes(1);
  });

  test("initDevices() rejection propagates and leaves state at 'initializing'", async () => {
    fakeDaily.startCameraShouldThrow = new Error("permission denied");
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await expect(transport.initDevices()).rejects.toThrow("permission denied");
    expect(transport.state).toBe("initializing");
    expect(recorder.states).toEqual(["initializing"]);
  });
});
