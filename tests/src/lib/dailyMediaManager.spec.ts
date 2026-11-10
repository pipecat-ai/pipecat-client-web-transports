/**
 * DailyMediaManager enableMic / enableCam / connect contract (the media
 * manager behind the SmallWebRTC and WebSocket transports).
 *
 * daily-js needs startCamera() once per session before setLocalAudio() /
 * setLocalVideo() do anything, so enabling a device with nothing running
 * starts media, disabling only records the preference, and a toggle during
 * a session is live only: the connect-time flags are frozen until
 * disconnect(), which resets the live state to them.
 */

import type { PipecatClientOptions } from "@pipecat-ai/client-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  createFakeDailyCallObject,
  type FakeDailyCallObject,
} from "../helpers/fakeDaily";
import { buildSpyCallbacks } from "../helpers/observeTransport";

let currentFakeDaily: FakeDailyCallObject | null = null;

vi.mock("@daily-co/daily-js", () => ({
  default: {
    createCallObject: () => currentFakeDaily,
    getCallInstance: () => null,
  },
}));

const { DailyMediaManager } = await import("@pipecat-ai/transport-lib");

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("DailyMediaManager", () => {
  let fakeDaily: FakeDailyCallObject;
  let manager: InstanceType<typeof DailyMediaManager>;
  let spies: ReturnType<typeof buildSpyCallbacks>["spies"];

  function build(opts: Partial<PipecatClientOptions> = {}) {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    // No player, no recorder: neither is needed to exercise device control.
    manager = new DailyMediaManager(false, false);
    const built = buildSpyCallbacks();
    spies = built.spies;
    manager.setClientOptions({
      transport: {} as never,
      callbacks: built.callbacks,
      ...opts,
    } as PipecatClientOptions);
  }

  beforeEach(() => build());

  test("a local track-started is reported to both the client callbacks and the transport's registered listener", async () => {
    const transportTrackStarted = vi.fn();
    manager.registerTrackCallbacks(transportTrackStarted, vi.fn());
    const track = { kind: "audio" } as MediaStreamTrack;

    fakeDaily.emit("track-started", {
      participant: { local: true, user_id: "local-1", user_name: "" },
      track,
      type: "audio",
    });
    await settle();

    expect(spies.onTrackStarted).toHaveBeenCalledWith(
      track,
      expect.objectContaining({ local: true })
    );
    expect(transportTrackStarted).toHaveBeenCalledWith(track, "audio");
  });

  test("pre-session enableMic(false) with nothing running records the preference only", async () => {
    await manager.enableMic(false);

    expect(fakeDaily.startCamera).not.toHaveBeenCalled();
    expect(fakeDaily.setLocalAudio).not.toHaveBeenCalled();
    expect(manager.isMicEnabled).toBe(false);
  });

  test("pre-session enableMic(true) with nothing running starts media and reports the devices", async () => {
    build({ enableMic: false });

    await manager.enableMic(true);
    await settle();

    expect(fakeDaily.startCameraCallCount).toBe(1);
    expect(fakeDaily.startCamera).toHaveBeenCalledWith(
      expect.objectContaining({ startAudioOff: false })
    );
    expect(spies.onMicUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "mic-1" })
    );
    expect(manager.isMicEnabled).toBe(true);
  });

  test("enableMic(true) then enableCam(true) share one startCamera() and the later toggle is applied once it resolves", async () => {
    build({ enableMic: false, enableCam: false });

    void manager.enableMic(true);
    manager.enableCam(true);
    await settle();

    expect(fakeDaily.startCameraCallCount).toBe(1);
    expect(fakeDaily.setLocalVideo).toHaveBeenCalledWith(true);
    expect(manager.isCamEnabled).toBe(true);
  });

  test("initialize() is idempotent: media starts once per session", async () => {
    await manager.initialize();
    await manager.initialize();

    expect(fakeDaily.startCameraCallCount).toBe(1);
  });

  test("a startCamera() failure from a lazy enable is reported via onDeviceError and can be retried", async () => {
    build({ enableMic: false });
    fakeDaily.startCameraShouldThrow = new Error("boom");

    await manager.enableMic(true);
    await settle();

    expect(spies.onDeviceError).toHaveBeenCalledTimes(1);
    expect(spies.onDeviceError.mock.calls[0][0].devices).toEqual(["mic"]);

    fakeDaily.startCameraShouldThrow = undefined;
    await manager.enableMic(true);
    await settle();

    expect(fakeDaily.startCameraCallCount).toBe(2);
  });

  test("with media running, a toggle is applied live", async () => {
    await manager.initialize();

    await manager.enableMic(false);
    manager.enableCam(true);

    expect(fakeDaily.setLocalAudio).toHaveBeenCalledWith(false);
    expect(fakeDaily.setLocalVideo).toHaveBeenCalledWith(true);
    expect(fakeDaily.startCameraCallCount).toBe(1);
  });

  test("connect() starts media when nothing is running, and leaves media started pre-connect as it is", async () => {
    await manager.connect();
    expect(fakeDaily.startCameraCallCount).toBe(1);

    await manager.disconnect();
    await manager.enableMic(true);
    await settle();
    expect(fakeDaily.startCameraCallCount).toBe(2);
    fakeDaily.setLocalAudio.mockClear();

    await manager.connect();

    expect(fakeDaily.startCameraCallCount).toBe(2);
    expect(fakeDaily.setLocalAudio).not.toHaveBeenCalled();
  });

  test("a mid-session toggle is live only: the next session starts from the connect-time flag", async () => {
    await manager.connect();

    await manager.enableMic(false);
    expect(fakeDaily.setLocalAudio).toHaveBeenCalledWith(false);
    expect(manager.isMicEnabled).toBe(false);

    await manager.disconnect();
    expect(manager.isMicEnabled).toBe(true);

    await manager.connect();

    expect(fakeDaily.startCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({ startAudioOff: false })
    );
  });

  test("a toggle between sessions updates the flag for the next connect()", async () => {
    await manager.connect();
    await manager.disconnect();

    await manager.enableMic(false);
    await manager.connect();

    expect(fakeDaily.startCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({ startAudioOff: true })
    );
    expect(manager.isMicEnabled).toBe(false);
  });

  test("a toggle while connect() is starting media is applied once it resolves", async () => {
    let resolveStart!: () => void;
    fakeDaily.startCamera.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveStart = () =>
            r({ camera: {}, mic: { deviceId: "mic-1" }, speaker: {} });
        })
    );
    const connecting = manager.connect();

    await manager.enableMic(false);
    expect(fakeDaily.setLocalAudio).not.toHaveBeenCalled();

    resolveStart();
    await connecting;

    expect(fakeDaily.setLocalAudio).toHaveBeenCalledWith(false);
    // The flag was frozen when connect() began.
    await manager.disconnect();
    expect(manager.isMicEnabled).toBe(true);
  });
});
