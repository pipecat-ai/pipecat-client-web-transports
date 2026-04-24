/**
 * Characterization tests for OpenAIRealTimeWebRTCTransport's initDevices()
 * contract. Locks in today's behavior ahead of Plan A step 2.
 *
 * OpenAI's transport reuses daily-js internally for device management, so we
 * mock @daily-co/daily-js here too. We also stub RTCPeerConnection because
 * the transport constructs one inside initialize().
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  createFakeDailyCallObject,
  type FakeDailyCallObject,
} from "../helpers/fakeDaily";
import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

let currentFakeDaily: FakeDailyCallObject | null = null;

vi.mock("@daily-co/daily-js", () => ({
  default: {
    createCallObject: () => currentFakeDaily,
    getCallInstance: () => null,
  },
}));

// Minimal RTCPeerConnection stub — initialize() only constructs one and
// assigns `ontrack` later. No ICE or data-channel behavior is exercised by
// the tests below.
class FakeRTCDataChannel {
  addEventListener = vi.fn();
  send = vi.fn();
  close = vi.fn();
}

class FakeRTCPeerConnection {
  ontrack: unknown = null;
  addTransceiver = vi.fn();
  addEventListener = vi.fn();
  createDataChannel = vi.fn(() => new FakeRTCDataChannel());
  close = vi.fn();
}
(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
  FakeRTCPeerConnection;

const { OpenAIRealTimeWebRTCTransport } = await import(
  "@pipecat-ai/openai-realtime-webrtc-transport"
);

describe("OpenAIRealTimeWebRTCTransport.initDevices() — characterization", () => {
  let fakeDaily: FakeDailyCallObject;
  let transport: InstanceType<typeof OpenAIRealTimeWebRTCTransport>;

  beforeEach(() => {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    transport = new OpenAIRealTimeWebRTCTransport({ api_key: "test-key" });
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

    expect(spies.onAvailableCamsUpdated).toHaveBeenCalledTimes(1);
    expect(spies.onAvailableMicsUpdated).toHaveBeenCalledTimes(1);
    expect(spies.onAvailableSpeakersUpdated).toHaveBeenCalledTimes(1);
    expect(spies.onCamUpdated).toHaveBeenCalledTimes(1);
    expect(spies.onMicUpdated).toHaveBeenCalledTimes(1);
    expect(spies.onSpeakerUpdated).toHaveBeenCalledTimes(1);
  });

  test("repeated initDevices() calls re-invoke startCamera and re-emit state transitions", async () => {
    const { callbacks, recorder } = buildSpyCallbacks();
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
  });

  test("second initDevices() does NOT restart the local audio observer (partial internal idempotency)", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();
    fakeDaily.isLocalAudioLevelObserverRunning.mockReturnValue(true);

    await transport.initDevices();

    expect(fakeDaily.startLocalAudioLevelObserver).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ enableMic: true, enableCam: false }, { startAudioOff: false }],
    [{ enableMic: false, enableCam: false }, { startAudioOff: true }],
    [{ enableMic: true, enableCam: true }, { startAudioOff: false }],
    [{ enableMic: false, enableCam: true }, { startAudioOff: true }],
  ])(
    "initDevices() with %j passes %j to startCamera (startVideoOff is hardcoded true regardless of enableCam)",
    async (opts, expectedCallArg) => {
      // OpenAI's transport hardcodes startVideoOff: true in initDevices, so
      // enableCam: true does NOT actually turn the camera on at init time.
      // enableMic flows through normally as startAudioOff: !enableMic.
      // Lock this in — the Plan B work around per-transport device management
      // (B3) will need to decide whether to keep this quirk.
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks, opts);

      await transport.initDevices();

      expect(fakeDaily.startCamera).toHaveBeenCalledTimes(1);
      expect(fakeDaily.startCamera).toHaveBeenCalledWith(
        expect.objectContaining({ ...expectedCallArg, startVideoOff: true })
      );
    }
  );

  test("initDevices() rejection propagates and leaves state at 'initializing'", async () => {
    fakeDaily.startCameraShouldThrow = new Error("permission denied");
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await expect(transport.initDevices()).rejects.toThrow("permission denied");
    expect(transport.state).toBe("initializing");
    expect(recorder.states).toEqual(["initializing"]);
  });
});
