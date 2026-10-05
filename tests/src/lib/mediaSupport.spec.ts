/**
 * What each media manager reports it can capture, for transports' mediaSupport.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createFakeDailyCallObject,
  type FakeDailyCallObject,
} from "../helpers/fakeDaily";

let currentFakeDaily: FakeDailyCallObject | null = null;

vi.mock("@daily-co/daily-js", () => ({
  default: {
    getCallInstance: () => undefined,
    createCallObject: () => currentFakeDaily,
  },
}));

const { DailyMediaManager, MediaManager, WavMediaManager } =
  await import("@pipecat-ai/transport-lib");

/** Give the browser a getDisplayMedia, or take it away. */
function setScreenShareSupport(supported: boolean) {
  const mediaDevices = {
    ...(navigator.mediaDevices ?? {}),
    getDisplayMedia: supported ? vi.fn() : undefined,
  };
  vi.stubGlobal("navigator", { ...navigator, mediaDevices });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MediaManager.mediaSupport", () => {
  // The base class's own getter, on an instance with no other behavior.
  const withScreenShare = (supported: boolean) =>
    Object.assign(Object.create(MediaManager.prototype), {
      _supportsScreenShare: supported,
    });

  test("rules out screen share for a media manager that doesn't support it", () => {
    expect(withScreenShare(false).mediaSupport).toEqual({ screenShare: false });
  });

  test("rules nothing out for a media manager that supports screen share", () => {
    expect(withScreenShare(true).mediaSupport).toEqual({});
  });
});

describe("WavMediaManager.mediaSupport", () => {
  test("captures the microphone only", () => {
    const manager = new WavMediaManager();
    expect(manager.mediaSupport).toEqual({
      mic: true,
      cam: false,
      screenShare: false,
    });
    expect(manager.supportsScreenShare).toBe(false);
  });
});

describe("DailyMediaManager.mediaSupport", () => {
  beforeEach(() => {
    currentFakeDaily = createFakeDailyCallObject();
  });

  test("captures the microphone, camera and screen where the browser can", () => {
    setScreenShareSupport(true);
    const manager = new DailyMediaManager();
    expect(manager.mediaSupport).toEqual({
      mic: true,
      cam: true,
      screenShare: true,
    });
    expect(manager.supportsScreenShare).toBe(true);
  });

  test("rules out screen share where the browser can't share a screen", () => {
    setScreenShareSupport(false);
    const manager = new DailyMediaManager();
    expect(manager.mediaSupport.screenShare).toBe(false);
    expect(manager.supportsScreenShare).toBe(false);
  });
});
