/**
 * The device contract every transport is held to, run through a real
 * PipecatClient. Each statement below is one describe block:
 *
 * 1. connect() with no prior initDevices() / enableMic() / enableCam()
 *    turns the devices on according to the enableMic / enableCam flags.
 * 2. Any of those calls before connect() means a pre-join experience, so
 *    connect() leaves the devices in whatever state they are in.
 * 3. disconnect() turns the devices off.
 * 4. Which of those two a connect() does is sticky across sessions: a client
 *    that connected by the flags keeps connecting by them, and one that
 *    connected as-is keeps connecting as-is (so after disconnect() it
 *    connects with the devices off unless they're turned on again). A call
 *    outside a session always switches to as-is, and nothing switches back.
 * 5. The enableMic / enableCam flags are set at construction and never
 *    change.
 * 6. initDevices() turns the devices on according to the flags. It is a
 *    no-op (that still reports the device lists) after any initDevices(),
 *    enableMic(), enableCam() or connect(), and works again after
 *    disconnect().
 * 7. A blocked device reports a DeviceError; the recovery is enableMic() /
 *    enableCam(), not another initDevices().
 * 8. A failed connect() turns the devices off, like any other disconnect.
 * 9. isMicEnabled / isCamEnabled report what the devices are actually doing.
 * 10. A transport that can't capture a cam throws UnsupportedFeatureError
 *     from enableCam(true), but initDevices() and connect() don't throw over
 *     the enableCam flag.
 *
 * Device state is read from the faked vendor layer (see DeviceLog), never
 * from the transport, so a transport that reports a device as on without
 * turning it on fails here.
 */

import {
  PipecatClient,
  UnsupportedFeatureError,
  type DeviceError,
} from "@pipecat-ai/client-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { current, installFakeNavigatorMedia } from "./fakes/media";
import {
  DeviceLog,
  type DeviceHarness,
  type DeviceKind,
  type HarnessInstance,
} from "./harness";

type Flags = { mic: boolean; cam: boolean };
type DeviceState = { mic: boolean; cam: boolean };

/** Let fire-and-forget device work (enableMic() etc. are sync) land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function within<T>(
  promise: Promise<T>,
  what: string,
  ms = 2000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} did not settle in ${ms}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function describeDeviceContract(harness: DeviceHarness): void {
  const camTest = test.skipIf(!harness.supportsCam);
  const camlessTest = test.skipIf(harness.supportsCam);

  describe(`device contract: ${harness.name}`, () => {
    let inst: HarnessInstance & { devices: DeviceLog };
    let client: PipecatClient | undefined;
    let restoreNavigator: () => void;
    const callbacks = {
      onDeviceError: vi.fn<(error: DeviceError) => void>(),
      onAvailableMicsUpdated: vi.fn(),
      onAvailableCamsUpdated: vi.fn(),
      onUnsupportedFeature: vi.fn(),
    };

    beforeEach(() => {
      Object.values(callbacks).forEach((spy) => spy.mockClear());
      restoreNavigator = installFakeNavigatorMedia();
      const devices = new DeviceLog();
      current.devices = devices;
      inst = { ...harness.create(devices), devices };
    });

    afterEach(async () => {
      try {
        await client?.disconnect();
      } catch {
        // The test already failed or the session never started.
      }
      client = undefined;
      inst.teardown?.();
      restoreNavigator();
      current.devices = null;
    });

    /** A client over this harness's transport, built from the flags. */
    function makeClient(flags: Flags): PipecatClient {
      client = new PipecatClient({
        transport: inst.transport,
        enableMic: flags.mic,
        enableCam: flags.cam,
        callbacks,
      });
      return client;
    }

    async function connect(c: PipecatClient): Promise<void> {
      await within(c.connect(inst.connectParams as never), "connect()");
      await settle();
    }

    async function disconnect(c: PipecatClient): Promise<void> {
      await within(c.disconnect(), "disconnect()");
      await settle();
    }

    async function initDevices(c: PipecatClient): Promise<void> {
      await within(c.initDevices(), "initDevices()");
      await settle();
    }

    /** What the devices are actually doing, per the faked vendor layer. */
    function devices(): DeviceState {
      return { mic: inst.devices.isOn("mic"), cam: inst.devices.isOn("cam") };
    }

    /** The on/off transitions `run` caused at the vendor layer. */
    async function transitionsDuring(run: () => Promise<void>) {
      const mark = inst.devices.transitions.length;
      await run();
      return inst.devices.since(mark);
    }

    async function enable(
      c: PipecatClient,
      kind: DeviceKind,
      on: boolean
    ): Promise<void> {
      if (kind === "mic") c.enableMic(on);
      else c.enableCam(on);
      await settle();
    }

    // -----------------------------------------------------------------------
    describe("1. connect() with no prior device calls follows the flags", () => {
      test("constructing the client turns nothing on", async () => {
        makeClient({ mic: true, cam: true });
        await settle();

        expect(devices()).toEqual({ mic: false, cam: false });
      });

      test("listing the devices before any device call turns nothing on", async () => {
        const c = makeClient({ mic: true, cam: true });

        const transitions = await transitionsDuring(async () => {
          await Promise.all([
            c.getAllMics(),
            c.getAllCams(),
            c.getAllSpeakers(),
          ]);
          await settle();
        });

        expect(transitions).toEqual([]);
        expect(callbacks.onDeviceError).not.toHaveBeenCalled();
      });

      test("enableMic: true, enableCam: false -> mic on, cam off", async () => {
        const c = makeClient({ mic: true, cam: false });

        await connect(c);

        expect(devices()).toEqual({ mic: true, cam: false });
      });

      test("enableMic: false -> mic off", async () => {
        const c = makeClient({ mic: false, cam: false });

        await connect(c);

        expect(devices()).toEqual({ mic: false, cam: false });
      });

      camTest(
        "enableMic: false, enableCam: true -> mic off, cam on",
        async () => {
          const c = makeClient({ mic: false, cam: true });

          await connect(c);

          expect(devices()).toEqual({ mic: false, cam: true });
        }
      );

      camTest("enableMic: true, enableCam: true -> both on", async () => {
        const c = makeClient({ mic: true, cam: true });

        await connect(c);

        expect(devices()).toEqual({ mic: true, cam: true });
      });

      test("a device turned off mid-session can be turned back on", async () => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);

        await enable(c, "mic", false);
        expect(devices().mic).toBe(false);

        await enable(c, "mic", true);
        expect(devices().mic).toBe(true);
      });

      test("a device the flags left off can be turned on mid-session", async () => {
        const c = makeClient({ mic: false, cam: false });
        await connect(c);

        await enable(c, "mic", true);

        expect(devices().mic).toBe(true);
      });

      camTest(
        "a cam the flags left off can be turned on mid-session",
        async () => {
          const c = makeClient({ mic: true, cam: false });
          await connect(c);

          await enable(c, "cam", true);

          expect(devices()).toEqual({ mic: true, cam: true });
        }
      );
    });

    // -----------------------------------------------------------------------
    describe("1b. a device call made while the devices are still starting isn't lost", () => {
      test("initDevices() then, without waiting, enableMic(false): the mic ends off", async () => {
        const c = makeClient({ mic: true, cam: false });

        const init = c.initDevices();
        c.enableMic(false);
        await within(init, "initDevices()");
        await settle();

        expect(devices()).toEqual({ mic: false, cam: false });
      });

      camTest(
        "initDevices() then, without waiting, enableCam(true): the cam ends on",
        async () => {
          const c = makeClient({ mic: true, cam: false });

          const init = c.initDevices();
          c.enableCam(true);
          await within(init, "initDevices()");
          await settle();

          expect(devices()).toEqual({ mic: true, cam: true });
        }
      );

      test("enableMic(true) then, without waiting, enableMic(false): the mic ends off", async () => {
        const c = makeClient({ mic: false, cam: false });

        c.enableMic(true);
        c.enableMic(false);
        await settle();

        expect(devices()).toEqual({ mic: false, cam: false });
      });

      test("enableMic(true) twice without waiting, then enableMic(false): the mic ends off", async () => {
        const c = makeClient({ mic: false, cam: false });

        c.enableMic(true);
        c.enableMic(true);
        await settle();
        await enable(c, "mic", false);

        // Two tracks acquired for the one mic would leave one capturing.
        expect(devices()).toEqual({ mic: false, cam: false });
      });

      camTest(
        "enableCam(true) then, without waiting, enableMic(true): both end on",
        async () => {
          const c = makeClient({ mic: false, cam: false });

          c.enableCam(true);
          c.enableMic(true);
          await settle();

          expect(devices()).toEqual({ mic: true, cam: true });
        }
      );

      test("connect() by the flags then, without waiting, enableMic(false): the session has the mic off", async () => {
        const c = makeClient({ mic: true, cam: false });

        const connecting = c.connect(inst.connectParams as never);
        c.enableMic(false);
        await within(connecting, "connect()");
        await settle();

        expect(devices()).toEqual({ mic: false, cam: false });
      });
    });

    // -----------------------------------------------------------------------
    describe("2. after a pre-connect device call, connect() keeps the devices as they are", () => {
      test("initDevices(), then the user turns the mic off: connect() keeps it off", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        expect(devices()).toEqual({ mic: true, cam: false });
        await enable(c, "mic", false);

        const during = await transitionsDuring(() => connect(c));

        expect(devices()).toEqual({ mic: false, cam: false });
        expect(during).toEqual([]);
      });

      test("initDevices(), untouched: connect() changes nothing", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);

        const during = await transitionsDuring(() => connect(c));

        expect(devices()).toEqual({ mic: true, cam: false });
        expect(during).toEqual([]);
      });

      test("enableMic(true) against an enableMic: false flag: connect() keeps the mic on", async () => {
        const c = makeClient({ mic: false, cam: false });
        await enable(c, "mic", true);
        expect(devices().mic).toBe(true);

        const during = await transitionsDuring(() => connect(c));

        expect(devices()).toEqual({ mic: true, cam: false });
        expect(during).toEqual([]);
      });

      test("enableMic(false) against an enableMic: true flag: connect() keeps the mic off", async () => {
        const c = makeClient({ mic: true, cam: false });
        await enable(c, "mic", false);

        const during = await transitionsDuring(() => connect(c));

        expect(devices()).toEqual({ mic: false, cam: false });
        expect(during).toEqual([]);
      });

      camTest(
        "initDevices(), then the user turns the cam on: connect() keeps it on",
        async () => {
          const c = makeClient({ mic: true, cam: false });
          await initDevices(c);
          await enable(c, "cam", true);
          expect(devices()).toEqual({ mic: true, cam: true });

          const during = await transitionsDuring(() => connect(c));

          expect(devices()).toEqual({ mic: true, cam: true });
          expect(during).toEqual([]);
        }
      );

      camTest(
        "enableCam(true) against an enableCam: false flag: connect() keeps the cam on",
        async () => {
          const c = makeClient({ mic: false, cam: false });
          await enable(c, "cam", true);
          expect(devices().cam).toBe(true);

          const during = await transitionsDuring(() => connect(c));

          expect(devices()).toEqual({ mic: false, cam: true });
          expect(during).toEqual([]);
        }
      );

      camTest(
        "enableCam(false) against an enableCam: true flag: connect() keeps the cam off",
        async () => {
          const c = makeClient({ mic: false, cam: true });
          await enable(c, "cam", false);

          const during = await transitionsDuring(() => connect(c));

          expect(devices()).toEqual({ mic: false, cam: false });
          expect(during).toEqual([]);
        }
      );

      camTest(
        "a call about one device covers both: enableCam(true) alone leaves the flagged-on mic off through connect()",
        async () => {
          const c = makeClient({ mic: true, cam: false });
          await enable(c, "cam", true);

          const during = await transitionsDuring(() => connect(c));

          expect(devices()).toEqual({ mic: false, cam: true });
          expect(during).toEqual([]);
        }
      );
    });

    // -----------------------------------------------------------------------
    describe("3. disconnect() turns the devices off", () => {
      test("after a connect() by the flags", async () => {
        const c = makeClient({ mic: true, cam: harness.supportsCam });
        await connect(c);

        await disconnect(c);

        expect(devices()).toEqual({ mic: false, cam: false });
      });

      test("after a connect() with pre-join devices", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        await connect(c);

        await disconnect(c);

        expect(devices()).toEqual({ mic: false, cam: false });
      });

      test("after a mid-session enableMic(true) on a session that started with the mic off", async () => {
        const c = makeClient({ mic: false, cam: false });
        await connect(c);
        await enable(c, "mic", true);

        await disconnect(c);

        expect(devices()).toEqual({ mic: false, cam: false });
      });
    });

    // -----------------------------------------------------------------------
    describe("4. connecting by the flags or as-is is sticky", () => {
      test("by the flags: a mid-session mute doesn't carry over, the next connect() follows the flags again", async () => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);
        await enable(c, "mic", false);
        await disconnect(c);

        await connect(c);

        expect(devices()).toEqual({ mic: true, cam: false });
      });

      camTest(
        "by the flags: a mid-session cam toggle doesn't carry over either",
        async () => {
          const c = makeClient({ mic: true, cam: false });
          await connect(c);
          await enable(c, "cam", true);
          await disconnect(c);

          await connect(c);

          expect(devices()).toEqual({ mic: true, cam: false });
        }
      );

      test("as-is: after disconnect(), connect() with no device calls connects with the devices off", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        await connect(c);
        await disconnect(c);

        const during = await transitionsDuring(() => connect(c));

        expect(devices()).toEqual({ mic: false, cam: false });
        expect(during).toEqual([]);
      });

      test("as-is: after disconnect(), enableMic(true) then connect() connects with just the mic on", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        await connect(c);
        await disconnect(c);
        await enable(c, "mic", true);

        const during = await transitionsDuring(() => connect(c));

        expect(devices()).toEqual({ mic: true, cam: false });
        expect(during).toEqual([]);
      });

      test("as-is never switches back: a third session still connects with the devices off", async () => {
        const c = makeClient({ mic: true, cam: false });
        await enable(c, "mic", true);
        await connect(c);
        await disconnect(c);
        await connect(c);
        await disconnect(c);

        await connect(c);

        expect(devices()).toEqual({ mic: false, cam: false });
      });

      test("a device call between sessions switches a by-the-flags client to as-is", async () => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);
        await disconnect(c);
        await enable(c, "mic", false);

        const during = await transitionsDuring(() => connect(c));

        expect(devices()).toEqual({ mic: false, cam: false });
        expect(during).toEqual([]);
      });

      camTest(
        "enableCam(true) between sessions switches to as-is: cam on, the flagged-on mic stays off",
        async () => {
          const c = makeClient({ mic: true, cam: false });
          await connect(c);
          await disconnect(c);
          await enable(c, "cam", true);

          const during = await transitionsDuring(() => connect(c));

          expect(devices()).toEqual({ mic: false, cam: true });
          expect(during).toEqual([]);
        }
      );

      test("a device call during a session does not switch a by-the-flags client to as-is", async () => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);
        await enable(c, "mic", false);
        await enable(c, "mic", true);
        await disconnect(c);

        await connect(c);

        expect(devices()).toEqual({ mic: true, cam: false });
      });
    });

    // -----------------------------------------------------------------------
    describe("5. the flags never change", () => {
      test("a pre-connect enableMic(false) doesn't change what a later initDevices() turns on", async () => {
        const c = makeClient({ mic: true, cam: false });
        await enable(c, "mic", false);
        await connect(c);
        await disconnect(c);

        await initDevices(c);

        expect(devices()).toEqual({ mic: true, cam: false });
      });

      test("a pre-connect enableMic(true) against an enableMic: false flag doesn't either", async () => {
        const c = makeClient({ mic: false, cam: false });
        await enable(c, "mic", true);
        await connect(c);
        await disconnect(c);

        await initDevices(c);

        expect(devices()).toEqual({ mic: false, cam: false });
      });

      camTest(
        "a pre-connect enableCam(true) against an enableCam: false flag doesn't either",
        async () => {
          const c = makeClient({ mic: true, cam: false });
          await enable(c, "cam", true);
          await connect(c);
          await disconnect(c);

          await initDevices(c);

          expect(devices()).toEqual({ mic: true, cam: false });
        }
      );
    });

    // -----------------------------------------------------------------------
    describe("6. initDevices()", () => {
      test("turns the devices on according to the flags", async () => {
        const c = makeClient({ mic: true, cam: false });

        await initDevices(c);

        expect(devices()).toEqual({ mic: true, cam: false });
      });

      test("with enableMic: false, leaves the mic off", async () => {
        const c = makeClient({ mic: false, cam: false });

        await initDevices(c);

        expect(devices()).toEqual({ mic: false, cam: false });
      });

      camTest("with enableCam: true, turns the cam on", async () => {
        const c = makeClient({ mic: false, cam: true });

        await initDevices(c);

        expect(devices()).toEqual({ mic: false, cam: true });
      });

      test("reports the device lists", async () => {
        const c = makeClient({ mic: true, cam: false });

        await initDevices(c);

        expect(callbacks.onAvailableMicsUpdated).toHaveBeenCalled();
      });

      test("a second call is a no-op: it doesn't turn back on a mic the user turned off", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        await enable(c, "mic", false);

        const during = await transitionsDuring(() => initDevices(c));

        expect(devices()).toEqual({ mic: false, cam: false });
        expect(during).toEqual([]);
      });

      camTest(
        "a second call is a no-op: it doesn't turn off a cam the user turned on",
        async () => {
          const c = makeClient({ mic: true, cam: false });
          await initDevices(c);
          await enable(c, "cam", true);

          const during = await transitionsDuring(() => initDevices(c));

          expect(devices()).toEqual({ mic: true, cam: true });
          expect(during).toEqual([]);
        }
      );

      test("a call after enableMic(false) is a no-op", async () => {
        const c = makeClient({ mic: true, cam: false });
        await enable(c, "mic", false);

        const during = await transitionsDuring(() => initDevices(c));

        expect(devices()).toEqual({ mic: false, cam: false });
        expect(during).toEqual([]);
      });

      test("a call after enableMic(true) against an enableMic: false flag is a no-op", async () => {
        const c = makeClient({ mic: false, cam: false });
        await enable(c, "mic", true);

        const during = await transitionsDuring(() => initDevices(c));

        expect(devices()).toEqual({ mic: true, cam: false });
        expect(during).toEqual([]);
      });

      camTest(
        "a call after enableCam(true) is a no-op: the flagged-on mic stays off",
        async () => {
          const c = makeClient({ mic: true, cam: false });
          await enable(c, "cam", true);

          const during = await transitionsDuring(() => initDevices(c));

          expect(devices()).toEqual({ mic: false, cam: true });
          expect(during).toEqual([]);
        }
      );

      test("a call during a session is a no-op", async () => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);
        await enable(c, "mic", false);

        const during = await transitionsDuring(() => initDevices(c));

        expect(devices()).toEqual({ mic: false, cam: false });
        expect(during).toEqual([]);
        expect(c.state).toBe("ready");
      });

      test("a no-op call still reports the device lists", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        callbacks.onAvailableMicsUpdated.mockClear();
        callbacks.onAvailableCamsUpdated.mockClear();

        await initDevices(c);

        expect(callbacks.onAvailableMicsUpdated).toHaveBeenCalled();
        if (harness.supportsCam) {
          expect(callbacks.onAvailableCamsUpdated).toHaveBeenCalled();
        }
      });

      test("a no-op call after enableMic() still reports the device lists", async () => {
        const c = makeClient({ mic: true, cam: false });
        await enable(c, "mic", true);
        callbacks.onAvailableMicsUpdated.mockClear();

        await initDevices(c);

        expect(callbacks.onAvailableMicsUpdated).toHaveBeenCalled();
      });

      test("works again after disconnect(), from the original flags", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        await enable(c, "mic", false);
        await connect(c);
        await disconnect(c);

        await initDevices(c);

        expect(devices()).toEqual({ mic: true, cam: false });
      });

      test("after disconnect() it works only once again", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        await connect(c);
        await disconnect(c);
        await initDevices(c);
        await enable(c, "mic", false);

        const during = await transitionsDuring(() => initDevices(c));

        expect(devices()).toEqual({ mic: false, cam: false });
        expect(during).toEqual([]);
      });

      test("after disconnect(), then connect(): the session keeps what initDevices() turned on", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        await enable(c, "mic", false);
        await connect(c);
        await disconnect(c);
        await initDevices(c);

        const during = await transitionsDuring(() => connect(c));

        expect(devices()).toEqual({ mic: true, cam: false });
        expect(during).toEqual([]);
      });
    });

    // -----------------------------------------------------------------------
    describe("7. blocked devices", () => {
      const errorsFor = (kind: DeviceKind) =>
        callbacks.onDeviceError.mock.calls.filter(([e]) =>
          e.devices.includes(kind)
        ).length;
      const micErrors = () => errorsFor("mic");

      test("initDevices() with the mic blocked reports a DeviceError and leaves the mic off", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });

        await initDevices(c);

        expect(micErrors()).toBeGreaterThan(0);
        expect(devices().mic).toBe(false);
      });

      test("a second initDevices() after the mic is unblocked is still a no-op", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        inst.devices.blocked.mic = false;

        await initDevices(c);

        expect(devices().mic).toBe(false);
      });

      test("enableMic(true) while still blocked reports another DeviceError", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        const before = micErrors();

        await enable(c, "mic", true);

        expect(micErrors()).toBeGreaterThan(before);
        expect(devices().mic).toBe(false);
      });

      test("enableMic(true) once unblocked turns the mic on", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        inst.devices.blocked.mic = false;

        await enable(c, "mic", true);

        expect(devices().mic).toBe(true);
      });

      test("enableMic(true) with the mic blocked, before anything else, reports a DeviceError", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: false, cam: false });

        await enable(c, "mic", true);

        expect(micErrors()).toBeGreaterThan(0);
        expect(devices().mic).toBe(false);
      });

      test("connect() by the flags with the mic blocked still connects, reports a DeviceError, mic off", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });

        await connect(c);

        expect(c.state).toBe("ready");
        expect(micErrors()).toBeGreaterThan(0);
        expect(devices().mic).toBe(false);
      });

      test("a connect() with the mic blocked never strands the client mid-transition", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });

        try {
          await connect(c);
        } catch {
          // Asserted above: it should connect. Here we only care that the
          // client can still be brought down.
        }
        await disconnect(c);

        expect(c.state).toBe("disconnected");
      });

      test("enableMic(true) mid-session once unblocked turns the mic on", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });
        await connect(c);
        inst.devices.blocked.mic = false;

        await enable(c, "mic", true);

        expect(devices().mic).toBe(true);
      });

      camTest(
        "enableCam(true) once the cam is unblocked turns it on",
        async () => {
          inst.devices.blocked.cam = true;
          const c = makeClient({ mic: false, cam: true });
          await initDevices(c);
          expect(
            callbacks.onDeviceError.mock.calls.some(([e]) =>
              e.devices.includes("cam")
            )
          ).toBe(true);
          expect(devices().cam).toBe(false);
          inst.devices.blocked.cam = false;

          await enable(c, "cam", true);

          expect(devices().cam).toBe(true);
        }
      );
    });

    // -----------------------------------------------------------------------
    describe("7b. a call reports each device it fails to turn on exactly once", () => {
      // How errors are grouped is up to the transport (one DeviceError
      // naming both devices, or one per device), but a single call must not
      // report the same device twice.
      const errorsFor = (kind: DeviceKind) =>
        callbacks.onDeviceError.mock.calls.filter(([e]) =>
          e.devices.includes(kind)
        ).length;

      test("initDevices() with the mic blocked", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });

        await initDevices(c);

        expect(errorsFor("mic")).toBe(1);
      });

      test("enableMic(true) with the mic blocked, before anything else", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: false, cam: false });

        await enable(c, "mic", true);

        expect(errorsFor("mic")).toBe(1);
      });

      test("enableMic(true) while the mic is still blocked after initDevices()", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        const before = errorsFor("mic");

        await enable(c, "mic", true);

        expect(errorsFor("mic") - before).toBe(1);
      });

      test("connect() by the flags with the mic blocked", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });

        await connect(c);

        expect(errorsFor("mic")).toBe(1);
      });

      camTest("initDevices() with the cam blocked", async () => {
        inst.devices.blocked.cam = true;
        const c = makeClient({ mic: false, cam: true });

        await initDevices(c);

        expect(errorsFor("cam")).toBe(1);
      });

      camTest("enableCam(true) with the cam blocked", async () => {
        inst.devices.blocked.cam = true;
        const c = makeClient({ mic: false, cam: false });

        await enable(c, "cam", true);

        expect(errorsFor("cam")).toBe(1);
      });

      camTest("initDevices() with both blocked reports each once", async () => {
        inst.devices.blocked.mic = true;
        inst.devices.blocked.cam = true;
        const c = makeClient({ mic: true, cam: true });

        await initDevices(c);

        expect(errorsFor("mic")).toBe(1);
        expect(errorsFor("cam")).toBe(1);
      });
    });

    // -----------------------------------------------------------------------
    describe("8. a failed connect() turns the devices off", () => {
      test("the pre-join devices go off, and a retry connects as-is (devices off)", async () => {
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        inst.failNextConnect();

        await expect(
          within(c.connect(inst.connectParams as never), "connect()")
        ).rejects.not.toThrow(/did not settle/);
        await settle();
        expect(devices()).toEqual({ mic: false, cam: false });
        expect(c.state).toBe("disconnected");

        await connect(c);
        expect(devices()).toEqual({ mic: false, cam: false });
      });

      test("a by-the-flags client retries by the flags", async () => {
        const c = makeClient({ mic: true, cam: false });
        inst.failNextConnect();

        await expect(
          within(c.connect(inst.connectParams as never), "connect()")
        ).rejects.not.toThrow(/did not settle/);
        await settle();
        expect(devices()).toEqual({ mic: false, cam: false });
        expect(c.state).toBe("disconnected");

        await connect(c);
        expect(devices()).toEqual({ mic: true, cam: false });
      });
    });

    // -----------------------------------------------------------------------
    describe("9. isMicEnabled / isCamEnabled report whether the device is on", () => {
      // Until the client's first device call or connect() they report the
      // flags. After that they follow the device: a call sets them to what
      // it asks for straight away, and a failure sets them back to false.
      function reported(c: PipecatClient): DeviceState {
        return {
          mic: c.isMicEnabled,
          cam: harness.supportsCam ? c.isCamEnabled : false,
        };
      }

      test("before anything, they report the flags", async () => {
        const c = makeClient({ mic: true, cam: harness.supportsCam });
        await settle();

        expect(reported(c)).toEqual({ mic: true, cam: harness.supportsCam });
      });

      test("before anything, with enableMic: false, the mic reports off", async () => {
        const c = makeClient({ mic: false, cam: false });
        await settle();

        expect(reported(c)).toEqual({ mic: false, cam: false });
      });

      camlessTest(
        "before anything, with enableCam: true, the cam reports off",
        async () => {
          const c = makeClient({ mic: true, cam: true });
          await settle();

          expect(c.isCamEnabled).toBe(false);
        }
      );

      test("after initDevices()", async () => {
        const c = makeClient({ mic: true, cam: harness.supportsCam });
        await initDevices(c);

        expect(reported(c)).toEqual(devices());
        expect(reported(c)).toEqual({ mic: true, cam: harness.supportsCam });
      });

      test("after a pre-connect enableMic(false) against an enableMic: true flag", async () => {
        const c = makeClient({ mic: true, cam: false });
        await enable(c, "mic", false);

        expect(reported(c)).toEqual({ mic: false, cam: false });
      });

      test("after a pre-connect enableMic(true) against an enableMic: false flag", async () => {
        const c = makeClient({ mic: false, cam: false });
        await enable(c, "mic", true);

        expect(reported(c)).toEqual({ mic: true, cam: false });
      });

      camTest(
        "after a pre-connect enableCam(true) alone: cam on, a flagged-on mic off",
        async () => {
          const c = makeClient({ mic: true, cam: false });
          await enable(c, "cam", true);

          expect(reported(c)).toEqual(devices());
          expect(reported(c)).toEqual({ mic: false, cam: true });
        }
      );

      test("after a connect() by the flags", async () => {
        const c = makeClient({ mic: true, cam: harness.supportsCam });
        await connect(c);

        expect(reported(c)).toEqual({ mic: true, cam: harness.supportsCam });
      });

      test("after a mid-session mute", async () => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);
        await enable(c, "mic", false);

        expect(reported(c)).toEqual({ mic: false, cam: false });
      });

      test("after a mid-session unmute", async () => {
        const c = makeClient({ mic: false, cam: false });
        await connect(c);
        await enable(c, "mic", true);

        expect(reported(c)).toEqual({ mic: true, cam: false });
      });

      test("after disconnect(), off, though the flags turn the mic on", async () => {
        const c = makeClient({ mic: true, cam: harness.supportsCam });
        await connect(c);
        await disconnect(c);

        expect(reported(c)).toEqual({ mic: false, cam: false });
      });

      test("right after enableMic(true), on before the mic has started", async () => {
        const c = makeClient({ mic: false, cam: false });

        c.enableMic(true);

        expect(c.isMicEnabled).toBe(true);
        await settle();
      });

      test("initDevices() with the mic blocked: on at once, then off when it fails", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });

        const done = c.initDevices();
        expect(c.isMicEnabled).toBe(true);
        await within(done, "initDevices()");
        await settle();

        expect(c.isMicEnabled).toBe(false);
      });

      test("enableMic(true) with the mic blocked: on at once, then off when it fails", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: false, cam: false });

        c.enableMic(true);
        expect(c.isMicEnabled).toBe(true);
        await settle();

        expect(c.isMicEnabled).toBe(false);
      });

      test("connect() by the flags with the mic blocked: off", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });
        await connect(c);

        expect(c.isMicEnabled).toBe(false);
      });

      test("enableMic(true) once unblocked: on", async () => {
        inst.devices.blocked.mic = true;
        const c = makeClient({ mic: true, cam: false });
        await initDevices(c);
        inst.devices.blocked.mic = false;
        await enable(c, "mic", true);

        expect(c.isMicEnabled).toBe(true);
        expect(devices().mic).toBe(true);
      });

      camTest(
        "initDevices() with the cam blocked: the mic on, the cam off",
        async () => {
          inst.devices.blocked.cam = true;
          const c = makeClient({ mic: true, cam: true });
          await initDevices(c);

          expect(reported(c)).toEqual(devices());
          expect(reported(c)).toEqual({ mic: true, cam: false });
        }
      );
    });

    // -----------------------------------------------------------------------
    describe("10. a transport without a cam", () => {
      camlessTest(
        "enableCam(true) throws UnsupportedFeatureError at the transport",
        () => {
          makeClient({ mic: true, cam: false });

          expect(() => inst.transport.enableCam(true)).toThrow(
            UnsupportedFeatureError
          );
        }
      );

      camlessTest("enableCam(true) throws mid-session too", async () => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);

        expect(() => inst.transport.enableCam(true)).toThrow(
          UnsupportedFeatureError
        );
      });

      camlessTest(
        "PipecatClient.enableCam(true) reports it through onUnsupportedFeature",
        () => {
          const c = makeClient({ mic: true, cam: false });

          c.enableCam(true);

          expect(callbacks.onUnsupportedFeature).toHaveBeenCalled();
        }
      );

      camlessTest(
        "initDevices() with enableCam: true doesn't throw, and turns the mic on",
        async () => {
          const c = makeClient({ mic: true, cam: true });

          await initDevices(c);

          expect(devices()).toEqual({ mic: true, cam: false });
        }
      );

      camlessTest(
        "connect() with enableCam: true doesn't throw, and turns the mic on",
        async () => {
          const c = makeClient({ mic: true, cam: true });

          await connect(c);

          expect(devices()).toEqual({ mic: true, cam: false });
        }
      );
    });

    // -----------------------------------------------------------------------
    describe("11. the track sent to the bot is the live local track", () => {
      /** Skip where the vendor SDK sends the tracks, not the transport. */
      function sent(kind: DeviceKind, skip: () => void) {
        if (!inst.sentTrack) skip();
        return inst.sentTrack!(kind);
      }

      function local(c: PipecatClient, kind: DeviceKind) {
        const tracks = c.tracks().local;
        return (kind === "mic" ? tracks.audio : tracks.video) ?? null;
      }

      test("connect() by the flags sends the mic", async ({ skip }) => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);

        expect(local(c, "mic")).not.toBeNull();
        expect(sent("mic", skip)).toBe(local(c, "mic"));
      });

      test("a pre-connect enableMic(true) against an enableMic: false flag is sent", async ({
        skip,
      }) => {
        const c = makeClient({ mic: false, cam: false });
        await enable(c, "mic", true);
        await connect(c);

        expect(local(c, "mic")).not.toBeNull();
        expect(sent("mic", skip)).toBe(local(c, "mic"));
      });

      test("a mic the flags left off is sent once turned on mid-session", async ({
        skip,
      }) => {
        const c = makeClient({ mic: false, cam: false });
        await connect(c);

        await enable(c, "mic", true);

        expect(local(c, "mic")).not.toBeNull();
        expect(sent("mic", skip)).toBe(local(c, "mic"));
      });

      test("a mic turned off and back on mid-session is sent", async ({
        skip,
      }) => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);

        await enable(c, "mic", false);
        await enable(c, "mic", true);

        expect(local(c, "mic")).not.toBeNull();
        expect(sent("mic", skip)).toBe(local(c, "mic"));
      });

      test("a mic switched mid-session is sent", async ({ skip }) => {
        const c = makeClient({ mic: true, cam: false });
        await connect(c);

        c.updateMic("mic-1");
        await settle();

        expect(local(c, "mic")).not.toBeNull();
        expect(sent("mic", skip)).toBe(local(c, "mic"));
      });

      camTest(
        "a cam the flags left off is sent once turned on mid-session",
        async ({ skip }) => {
          const c = makeClient({ mic: true, cam: false });
          await connect(c);

          await enable(c, "cam", true);

          expect(local(c, "cam")).not.toBeNull();
          expect(sent("cam", skip)).toBe(local(c, "cam"));
        }
      );
    });
  });
}
