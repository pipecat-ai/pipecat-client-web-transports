/**
 * DailyTransport.enableMic / enableCam contract.
 *
 * daily-js needs startCamera() (or join()) once per session before
 * setLocalAudio() / setLocalVideo() do anything, so:
 *   - with nothing running, enabling a device starts media via startCamera()
 *     with the connect-time flags, and disabling only records the preference;
 *   - with media running, a toggle is applied live;
 *   - outside a session a toggle also updates the connect-time flags
 *     (startAudioOff / startVideoOff) so the next connect() lands on it;
 *     inside a session the flags are frozen, so a mid-session mute does not
 *     leak into the next connect().
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

const ROOM = { url: "https://x.daily.co/r" };

// Let the fire-and-forget startCamera() kicked off by enableMic/enableCam
// settle: the fake resolves startCamera in a microtask, then the transport
// enumerates and reports.
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("DailyTransport.enableMic", () => {
  let fakeDaily: FakeDailyCallObject;
  let transport: InstanceType<typeof DailyTransport>;
  let spies: ReturnType<typeof buildSpyCallbacks>["spies"];

  beforeEach(() => {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    transport = new DailyTransport();
    const built = buildSpyCallbacks();
    spies = built.spies;
    wireTransport(transport, built.callbacks);
  });

  test("pre-session enableMic(false) with nothing running records the preference only", () => {
    transport.enableMic(false);

    expect(fakeDaily.startCamera).not.toHaveBeenCalled();
    expect(fakeDaily.setLocalAudio).not.toHaveBeenCalled();
    expect(transport.isMicEnabled).toBe(false);
  });

  test("pre-session enableMic(false) is remembered for the next session via startCamera({ startAudioOff: true })", async () => {
    transport.enableMic(false);

    await transport.initDevices();

    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: true })
    );
  });

  test("pre-session enableMic(true) with nothing running starts media and reports the devices", async () => {
    transport.enableMic(false);
    transport.enableMic(true);
    await settle();

    expect(fakeDaily.startCameraCallCount).toBe(1);
    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: false })
    );
    expect(spies.onMicUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "mic-1" })
    );
    expect(spies.onAvailableMicsUpdated).toHaveBeenCalledTimes(1);
  });

  test("enableMic(true) then enableCam(true) share one startCamera() and the later toggle is applied once it resolves", async () => {
    transport.enableMic(true);
    transport.enableCam(true);
    await settle();

    expect(fakeDaily.startCameraCallCount).toBe(1);
    // The cam toggle arrived while startCamera() was in flight.
    expect(fakeDaily.setLocalVideo).toHaveBeenCalledWith(true);
    expect(transport.isCamEnabled).toBe(true);
  });

  test("a startCamera() failure from a lazy enable is reported via onDeviceError and can be retried", async () => {
    fakeDaily.startCameraShouldThrow = new Error("boom");
    transport.enableMic(true);
    await settle();

    expect(spies.onDeviceError).toHaveBeenCalledTimes(1);
    expect(spies.onDeviceError.mock.calls[0][0].devices).toEqual(["mic"]);

    fakeDaily.startCameraShouldThrow = undefined;
    transport.enableMic(true);
    await settle();

    expect(fakeDaily.startCameraCallCount).toBe(2);
  });

  test("with media running (after initDevices), a toggle is applied live via setLocalAudio", async () => {
    await transport.initDevices();

    transport.enableMic(false);

    expect(fakeDaily.setLocalAudio).toHaveBeenCalledTimes(1);
    expect(fakeDaily.setLocalAudio).toHaveBeenCalledWith(false);
    expect(fakeDaily.startCameraCallCount).toBe(1);
  });

  test("initDevices() after a lazy enable does not start media again", async () => {
    transport.enableMic(true);
    await settle();

    await transport.initDevices();

    expect(fakeDaily.startCameraCallCount).toBe(1);
  });

  test("connect() leaves media started pre-connect as it is", async () => {
    await transport.initDevices();
    transport.enableMic(false);
    fakeDaily.setLocalAudio.mockClear();

    await transport._connect(ROOM);

    expect(fakeDaily.join).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: true })
    );
    expect(fakeDaily.setLocalAudio).not.toHaveBeenCalled();
    expect(transport.isMicEnabled).toBe(false);
  });

  test("a mid-session toggle is live only: the connect-time flag is frozen, so the next connect() starts from it", async () => {
    await transport._connect(ROOM);

    transport.enableMic(false);

    expect(fakeDaily.setLocalAudio).toHaveBeenCalledWith(false);
    expect(transport.isMicEnabled).toBe(false);

    await transport._disconnect();

    // Live state goes back to the connect-time flag once the session ends.
    expect(transport.isMicEnabled).toBe(true);

    await transport._connect(ROOM);

    expect(fakeDaily.join).toHaveBeenLastCalledWith(
      expect.objectContaining({ startAudioOff: false })
    );
  });

  test("a toggle between sessions updates the flag for the next connect()", async () => {
    await transport._connect(ROOM);
    await transport._disconnect();

    transport.enableMic(false);
    await transport._connect(ROOM);

    expect(fakeDaily.join).toHaveBeenLastCalledWith(
      expect.objectContaining({ startAudioOff: true })
    );
    expect(transport.isMicEnabled).toBe(false);
  });

  test("after a session ends, enableMic(true) starts media again rather than toggling a torn-down call", async () => {
    await transport._connect(ROOM);
    await transport._disconnect();
    fakeDaily.setLocalAudio.mockClear();

    transport.enableMic(true);
    await settle();

    expect(fakeDaily.startCameraCallCount).toBe(1);
    expect(fakeDaily.setLocalAudio).not.toHaveBeenCalled();
  });

  test("a toggle while join() is in flight goes straight to daily-js, which lands it after join", async () => {
    let resolveJoin!: () => void;
    fakeDaily.join.mockImplementationOnce(
      () => new Promise<void>((r) => (resolveJoin = r))
    );
    const connecting = transport._connect(ROOM);

    transport.enableMic(false);

    expect(fakeDaily.setLocalAudio).toHaveBeenCalledWith(false);
    expect(fakeDaily.startCamera).not.toHaveBeenCalled();
    expect(transport.isMicEnabled).toBe(false);

    resolveJoin();
    await connecting;

    expect(fakeDaily.setLocalAudio).toHaveBeenCalledTimes(1);
    // The session started with the flags as they were when join() began.
    expect(fakeDaily.join).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: false })
    );
  });

  test("after a failed join() and the disconnect() the client issues, enableMic(true) starts media afresh", async () => {
    fakeDaily.join.mockRejectedValueOnce(new Error("no room"));
    await expect(transport._connect(ROOM)).rejects.toThrow();
    expect(transport.state).toBe("error");
    // PipecatClient.connect() calls disconnect() on a failed connect.
    await transport._disconnect();

    transport.enableMic(true);
    await settle();

    expect(fakeDaily.startCameraCallCount).toBe(1);
  });
});

describe("DailyTransport.enableCam", () => {
  let fakeDaily: FakeDailyCallObject;
  let transport: InstanceType<typeof DailyTransport>;

  beforeEach(() => {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    transport = new DailyTransport();
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);
  });

  test("pre-session enableCam(true) with nothing running starts media with the cam on", async () => {
    transport.enableCam(true);
    await settle();

    expect(fakeDaily.startCameraCallCount).toBe(1);
    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startVideoOff: false })
    );
    expect(fakeDaily.setLocalVideo).not.toHaveBeenCalled();
    expect(transport.isCamEnabled).toBe(true);
  });

  test("pre-session enableCam(true) is remembered for the next session", async () => {
    transport.enableCam(true);
    await settle();

    await transport._connect({ url: "https://x.daily.co/r" });

    expect(fakeDaily.join).toHaveBeenCalledWith(
      expect.objectContaining({ startVideoOff: false })
    );
  });

  test("with media running, enableCam(true) is applied live via setLocalVideo", async () => {
    await transport.initDevices();

    transport.enableCam(true);

    expect(fakeDaily.setLocalVideo).toHaveBeenCalledTimes(1);
    expect(fakeDaily.setLocalVideo).toHaveBeenCalledWith(true);
  });
});
