/**
 * Screen share is only claimed where the browser can share a screen.
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

const { browserSupportsScreenShare, DailyMediaManager } =
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

describe("browserSupportsScreenShare", () => {
  test("is true when the browser has getDisplayMedia", () => {
    setScreenShareSupport(true);
    expect(browserSupportsScreenShare()).toBe(true);
  });

  test("is false without getDisplayMedia, as on most mobile browsers", () => {
    setScreenShareSupport(false);
    expect(browserSupportsScreenShare()).toBe(false);
  });
});

describe("DailyMediaManager.supportsScreenShare", () => {
  beforeEach(() => {
    currentFakeDaily = createFakeDailyCallObject();
  });

  test("is true where the browser can share a screen", () => {
    setScreenShareSupport(true);
    expect(new DailyMediaManager().supportsScreenShare).toBe(true);
  });

  test("is false where the browser can't share a screen", () => {
    setScreenShareSupport(false);
    expect(new DailyMediaManager().supportsScreenShare).toBe(false);
  });
});
