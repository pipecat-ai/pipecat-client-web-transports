/**
 * Fake daily-js call object for characterization tests. Covers only the
 * surface that DailyTransport / OpenAI-WebRTC transport exercises during
 * initialize() and initDevices().
 */

import { vi, type Mock } from "vitest";

export interface FakeDailyCallObject {
  on: Mock;
  off: Mock;
  startCamera: Mock;
  enumerateDevices: Mock;
  isLocalAudioLevelObserverRunning: Mock;
  isRemoteParticipantsAudioLevelObserverRunning: Mock;
  startLocalAudioLevelObserver: Mock;
  startRemoteParticipantsAudioLevelObserver: Mock;
  startCameraCallCount: number;
  startCameraShouldThrow?: Error;
}

export function createFakeDailyCallObject(): FakeDailyCallObject {
  const fake = {
    startCameraCallCount: 0,
    startCameraShouldThrow: undefined as Error | undefined,
    on: vi.fn(),
    off: vi.fn(),
    startCamera: vi.fn(async function (this: FakeDailyCallObject) {
      this.startCameraCallCount += 1;
      if (this.startCameraShouldThrow) throw this.startCameraShouldThrow;
      return {
        camera: { deviceId: "cam-1", label: "Fake Cam", kind: "videoinput" },
        mic: { deviceId: "mic-1", label: "Fake Mic", kind: "audioinput" },
        speaker: {
          deviceId: "spk-1",
          label: "Fake Speaker",
          kind: "audiooutput",
        },
      };
    }),
    enumerateDevices: vi.fn(async () => ({ devices: [] })),
    isLocalAudioLevelObserverRunning: vi.fn(() => false),
    isRemoteParticipantsAudioLevelObserverRunning: vi.fn(() => false),
    startLocalAudioLevelObserver: vi.fn(async () => {}),
    startRemoteParticipantsAudioLevelObserver: vi.fn(async () => {}),
  };

  // bind startCamera so `this` resolves correctly in the async function above
  fake.startCamera = fake.startCamera.bind(fake) as Mock;

  return fake as FakeDailyCallObject;
}
