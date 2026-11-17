/**
 * Characterization tests for DailyTransport.enableMic / enableCam: before
 * local media is running, turning a device on starts it (startCamera) with
 * just that device, and turning one off does nothing; once it's running,
 * changes are applied live. The enableMic / enableCam flags initDevices()
 * uses never change.
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

  test("pre-session enableMic(false) doesn't start local media", () => {
    transport.enableMic(false);

    expect(fakeDaily.startCamera).not.toHaveBeenCalled();
  });

  test("pre-session enableMic(false) doesn't change what initDevices() turns on", async () => {
    transport.enableMic(false);

    await transport.initDevices();

    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: false })
    );
  });

  test("pre-session enableMic(true) starts local media with just the mic", () => {
    transport.enableMic(true);

    expect(fakeDaily.startCamera).toHaveBeenCalledTimes(1);
    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: false, startVideoOff: true })
    );
  });

  test("enableMic(false) once local media is running IS applied live via setLocalAudio", async () => {
    await transport.initDevices();

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

  test("pre-session enableCam(true) starts local media with just the cam", () => {
    transport.enableCam(true);

    expect(fakeDaily.startCamera).toHaveBeenCalledTimes(1);
    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: true, startVideoOff: false })
    );
  });

  test("enableCam(true) once local media is running IS applied live via setLocalVideo", async () => {
    await transport.initDevices();

    transport.enableCam(true);

    expect(fakeDaily.setLocalVideo).toHaveBeenCalledTimes(1);
    expect(fakeDaily.setLocalVideo).toHaveBeenCalledWith(true);
  });
});
