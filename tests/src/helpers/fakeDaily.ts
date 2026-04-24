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
  const fake: FakeDailyCallObject = {
    startCameraCallCount: 0,
    startCameraShouldThrow: undefined,
    on: vi.fn(),
    off: vi.fn(),
    startCamera: vi.fn(),
    enumerateDevices: vi.fn(async () => ({ devices: [] })),
    isLocalAudioLevelObserverRunning: vi.fn(() => false),
    isRemoteParticipantsAudioLevelObserverRunning: vi.fn(() => false),
    startLocalAudioLevelObserver: vi.fn(async () => {}),
    startRemoteParticipantsAudioLevelObserver: vi.fn(async () => {}),
  };

  // Close over `fake` rather than binding `this` — vitest loses its Mock
  // identity through Function.prototype.bind, which breaks
  // toHaveBeenCalledTimes etc.
  fake.startCamera.mockImplementation(async () => {
    fake.startCameraCallCount += 1;
    if (fake.startCameraShouldThrow) throw fake.startCameraShouldThrow;
    return {
      camera: { deviceId: "cam-1", label: "Fake Cam", kind: "videoinput" },
      mic: { deviceId: "mic-1", label: "Fake Mic", kind: "audioinput" },
      speaker: {
        deviceId: "spk-1",
        label: "Fake Speaker",
        kind: "audiooutput",
      },
    };
  });

  return fake;
}
