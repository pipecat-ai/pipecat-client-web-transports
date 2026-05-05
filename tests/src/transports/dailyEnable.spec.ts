/**
 * Characterization tests for DailyTransport.enableMic / enableCam under
 * Plan B2: pre-session toggles are remembered for the next session, and
 * applied live only when the call is joined.
 *
 * Pre-fix, both methods called setLocalAudio / setLocalVideo
 * unconditionally — pre-session calls silently no-opped at the daily-js
 * layer AND nothing was stored, so the next connect() lost the change.
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
  },
}));

const { DailyTransport } = await import("@pipecat-ai/daily-transport");

describe("DailyTransport.enableMic — characterization", () => {
  let fakeDaily: FakeDailyCallObject;
  let transport: InstanceType<typeof DailyTransport>;

  beforeEach(() => {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    transport = new DailyTransport();
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

  test("pre-session enableMic(true) flips startAudioOff back to false on the next session", async () => {
    transport.enableMic(false);
    transport.enableMic(true);

    await transport.initDevices();

    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: false })
    );
  });

  test("post-join enableMic(false) IS applied live via setLocalAudio", () => {
    fakeDaily.setJoined(true);

    transport.enableMic(false);

    expect(fakeDaily.setLocalAudio).toHaveBeenCalledTimes(1);
    expect(fakeDaily.setLocalAudio).toHaveBeenCalledWith(false);
  });
});

describe("DailyTransport.enableCam — characterization", () => {
  let fakeDaily: FakeDailyCallObject;
  let transport: InstanceType<typeof DailyTransport>;

  beforeEach(() => {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    transport = new DailyTransport();
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
  });

  test("pre-session enableCam(true) does NOT call setLocalVideo", () => {
    transport.enableCam(true);

    expect(fakeDaily.setLocalVideo).not.toHaveBeenCalled();
  });

  test("pre-session enableCam(true) IS remembered for the next session via startCamera({ startVideoOff: false })", async () => {
    transport.enableCam(true);

    await transport.initDevices();

    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startVideoOff: false })
    );
  });

  test("post-join enableCam(true) IS applied live via setLocalVideo", () => {
    fakeDaily.setJoined(true);

    transport.enableCam(true);

    expect(fakeDaily.setLocalVideo).toHaveBeenCalledTimes(1);
    expect(fakeDaily.setLocalVideo).toHaveBeenCalledWith(true);
  });
});
