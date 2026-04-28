/**
 * Minimal MediaManager double for transports that accept DI. We avoid pulling
 * the real DailyMediaManager / WavMediaManager so tests don't depend on
 * WavRecorder, AudioContext, or navigator.mediaDevices.
 *
 * The transports we inject into (SmallWebRTC, WebSocket, Gemini Live) call a
 * tiny slice of MediaManager's surface during initialize() and initDevices():
 * setUserAudioCallback, setClientOptions, and initialize(). This fake covers
 * that slice plus the abstract-class members needed for a structural match,
 * and is cast to MediaManager at each injection site to avoid importing the
 * MediaManager type (which transitively pulls wavtools without types).
 */

import { vi } from "vitest";

export interface FakeMediaManager {
  initializeCallCount: number;
  initializeShouldThrow?: Error;
  initialize: (...args: unknown[]) => Promise<void>;
  setUserAudioCallback: (...args: unknown[]) => void;
  setClientOptions: (...args: unknown[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export function createFakeMediaManager(): FakeMediaManager {
  const fake: FakeMediaManager = {
    initializeCallCount: 0,
    initializeShouldThrow: undefined,

    setUserAudioCallback: vi.fn(),
    setClientOptions: vi.fn(),

    initialize: vi.fn(async function (this: FakeMediaManager) {
      this.initializeCallCount += 1;
      if (this.initializeShouldThrow) throw this.initializeShouldThrow;
    }),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),

    userStartedSpeaking: vi.fn(async () => undefined),
    bufferBotAudio: vi.fn(() => undefined),

    getAllMics: vi.fn(async () => []),
    getAllCams: vi.fn(async () => []),
    getAllSpeakers: vi.fn(async () => []),

    updateMic: vi.fn(),
    updateCam: vi.fn(),
    updateSpeaker: vi.fn(),

    selectedMic: {},
    selectedCam: {},
    selectedSpeaker: {},

    enableMic: vi.fn(),
    enableCam: vi.fn(),
    enableScreenShare: vi.fn(),

    isCamEnabled: false,
    isMicEnabled: true,
    isSharingScreen: false,
    supportsScreenShare: false,

    tracks: vi.fn(() => ({ local: { audio: undefined, video: undefined } })),
  };

  // Bind the initialize implementation so `this` resolves to the fake itself.
  const boundInit = fake.initialize.bind(fake);
  fake.initialize = boundInit;

  return fake;
}
