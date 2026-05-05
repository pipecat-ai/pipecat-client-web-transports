/**
 * Characterization tests for OpenAIRealTimeWebRTCTransport.enableMic /
 * enableCam under Plan B2: pre-session toggles are remembered for the
 * next session, and applied live only when the call is joined.
 *
 * Pre-fix, the methods guarded with `if (!this._daily.participants()?.local) return;`
 * which silently dropped pre-session calls AND nothing was stored, so
 * the next initDevices() lost the change.
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

describe("OpenAIRealTimeWebRTCTransport.enableMic — characterization", () => {
  let fakeDaily: FakeDailyCallObject;
  let transport: InstanceType<typeof OpenAIRealTimeWebRTCTransport>;

  beforeEach(() => {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    transport = new OpenAIRealTimeWebRTCTransport({ api_key: "test-key" });
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
  });

  test("pre-session enableMic(false) does NOT call setLocalAudio (call not joined yet)", () => {
    transport.enableMic(false);

    expect(fakeDaily.setLocalAudio).not.toHaveBeenCalled();
  });

  test("pre-session enableMic(false) IS remembered for the next session via startCamera({ startAudioOff: true })", async () => {
    transport.enableMic(false);

    await transport.initDevices();

    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: true })
    );
  });

  test("post-join enableMic(false) IS applied live via setLocalAudio", () => {
    fakeDaily.setJoined(true);

    transport.enableMic(false);

    expect(fakeDaily.setLocalAudio).toHaveBeenCalledTimes(1);
    expect(fakeDaily.setLocalAudio).toHaveBeenCalledWith(false);
  });

  test("isMicEnabled pre-session reflects the stored preference, not daily-js's live state", () => {
    transport.enableMic(false);

    // Pre-fix: daily.localAudio() returned a stale/default value before
    // the call joined, hiding the user's intent. Now the getter falls
    // back to the stored preference.
    expect(transport.isMicEnabled).toBe(false);
  });

  test("isMicEnabled post-join reflects daily-js's live state", () => {
    fakeDaily.setJoined(true);

    transport.enableMic(false);

    expect(transport.isMicEnabled).toBe(false);
  });

  test("a user's enableMic preference survives _disconnect's reset (re-initialize)", () => {
    // _disconnect() calls initialize(this._options, ...) again as a reset
    // hook. The first version of this fix re-derived _micEnabled from
    // options on every initialize(), which clobbered the user's most
    // recent toggle on reconnect (caught by Copilot review on PR #114).
    // After the gate, the second initialize() must NOT overwrite the
    // stored preference.
    transport.enableMic(false);
    // Simulate _disconnect's re-init. PipecatClientOptions still has
    // enableMic: true (the original construction value).
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    // Run initDevices again to observe what startCamera receives.
    void transport.initDevices();

    expect(fakeDaily.startCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({ startAudioOff: true })
    );
  });
});

describe("OpenAIRealTimeWebRTCTransport.enableCam — characterization", () => {
  let fakeDaily: FakeDailyCallObject;
  let transport: InstanceType<typeof OpenAIRealTimeWebRTCTransport>;

  beforeEach(() => {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    transport = new OpenAIRealTimeWebRTCTransport({ api_key: "test-key" });
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
  });

  test("pre-session enableCam(true) does NOT call setLocalVideo", () => {
    transport.enableCam(true);

    expect(fakeDaily.setLocalVideo).not.toHaveBeenCalled();
  });

  test("startCamera always passes startVideoOff: true regardless of enableCam (locked-in OpenAI quirk)", async () => {
    // OpenAI is audio-only today; the transport hardcodes startVideoOff
    // in initDevices(). Storing _camEnabled is forward-looking but does
    // not yet alter the startCamera call. Lock this in so a future
    // change is deliberate.
    transport.enableCam(true);

    await transport.initDevices();

    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startVideoOff: true })
    );
  });

  test("post-join enableCam(true) IS applied live via setLocalVideo", () => {
    fakeDaily.setJoined(true);

    transport.enableCam(true);

    expect(fakeDaily.setLocalVideo).toHaveBeenCalledTimes(1);
    expect(fakeDaily.setLocalVideo).toHaveBeenCalledWith(true);
  });

  test("isCamEnabled pre-session reflects the stored preference", () => {
    transport.enableCam(true);

    expect(transport.isCamEnabled).toBe(true);
  });
});
