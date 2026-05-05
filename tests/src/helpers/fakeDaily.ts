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
  participants: Mock;
  setLocalAudio: Mock;
  setLocalVideo: Mock;
  localAudio: Mock;
  localVideo: Mock;
  setJoined: (joined: boolean) => void;
  startCameraCallCount: number;
  startCameraShouldThrow?: Error;
}

export function createFakeDailyCallObject(): FakeDailyCallObject {
  // Tracks whether the call has been "joined" — used by participants() so
  // tests can model the pre-session vs post-join boundary that
  // enableMic/enableCam now guards on.
  let joined = false;
  // Tracks last-applied audio/video state, mirrored by setLocalAudio /
  // setLocalVideo so localAudio() / localVideo() can return realistic
  // values once the call is joined.
  let audioOn = true;
  let videoOn = false;

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
    participants: vi.fn(() => (joined ? { local: { id: "local-1" } } : {})),
    setLocalAudio: vi.fn((enable: boolean) => {
      audioOn = enable;
    }),
    setLocalVideo: vi.fn((enable: boolean) => {
      videoOn = enable;
    }),
    localAudio: vi.fn(() => audioOn),
    localVideo: vi.fn(() => videoOn),
    setJoined: (next: boolean) => {
      joined = next;
    },
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
