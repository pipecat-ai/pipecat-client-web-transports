/**
 * DailyTransport must have its audio level observers running for every
 * session, whether or not initDevices() ran first.
 *
 * PipecatClient only drives an implicit initDevices() when a device the
 * caller opted into is still uninitialized, so it is skipped when both mic
 * and cam start disabled, and on a reconnect. Before the fix the observers
 * were only started in initDevices(), so in those paths onLocalAudioLevel /
 * onRemoteAudioLevel never fired (issue #216).
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

const connectParams = { url: "https://example.daily.co/room" };

describe("DailyTransport audio level observers", () => {
  let fakeDaily: FakeDailyCallObject;
  let transport: InstanceType<typeof DailyTransport>;

  beforeEach(() => {
    fakeDaily = createFakeDailyCallObject();
    currentFakeDaily = fakeDaily;
    transport = new DailyTransport();
  });

  test("connect() without initDevices() starts both observers (mic and cam start disabled)", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks, { enableMic: false, enableCam: false });

    await transport.connect(connectParams);

    expect(fakeDaily.startCamera).not.toHaveBeenCalled();
    expect(fakeDaily.startLocalAudioLevelObserver).toHaveBeenCalledTimes(1);
    expect(
      fakeDaily.startRemoteParticipantsAudioLevelObserver
    ).toHaveBeenCalledTimes(1);
    expect(transport.state).toBe("connected");
  });

  test("connect() after initDevices() does not start observers that are already running", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();
    fakeDaily.isLocalAudioLevelObserverRunning.mockReturnValue(true);
    fakeDaily.isRemoteParticipantsAudioLevelObserverRunning.mockReturnValue(
      true
    );

    await transport.connect(connectParams);

    expect(fakeDaily.startLocalAudioLevelObserver).toHaveBeenCalledTimes(1);
    expect(
      fakeDaily.startRemoteParticipantsAudioLevelObserver
    ).toHaveBeenCalledTimes(1);
  });

  test("reconnecting without a second initDevices() restarts the observers stopped by disconnect()", async () => {
    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();
    await transport.connect(connectParams);
    await transport.disconnect();

    expect(fakeDaily.stopLocalAudioLevelObserver).toHaveBeenCalledTimes(1);
    expect(
      fakeDaily.stopRemoteParticipantsAudioLevelObserver
    ).toHaveBeenCalledTimes(1);

    fakeDaily.startLocalAudioLevelObserver.mockClear();
    fakeDaily.startRemoteParticipantsAudioLevelObserver.mockClear();

    await transport.connect(connectParams);

    expect(fakeDaily.startLocalAudioLevelObserver).toHaveBeenCalledTimes(1);
    expect(
      fakeDaily.startRemoteParticipantsAudioLevelObserver
    ).toHaveBeenCalledTimes(1);
  });

  test("a failing observer start does not fail connect()", async () => {
    const { callbacks, spies } = buildSpyCallbacks();
    wireTransport(transport, callbacks, { enableMic: false, enableCam: false });
    fakeDaily.startLocalAudioLevelObserver.mockRejectedValueOnce(
      new Error("not supported")
    );

    await transport.connect(connectParams);

    expect(transport.state).toBe("connected");
    expect(spies.onConnected).toHaveBeenCalledTimes(1);
  });
});
