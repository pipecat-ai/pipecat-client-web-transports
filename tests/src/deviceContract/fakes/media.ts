/**
 * Browser media stand-ins shared by the device contract fakes, plus the
 * holder that connects the vi.mock() factories (hoisted, so they can't close
 * over a test's locals) to the DeviceLog of the test that's running.
 */

import type { DeviceKind, DeviceLog } from "../harness";

export const current: { devices: DeviceLog | null } = { devices: null };

export function currentDevices(): DeviceLog {
  if (!current.devices) {
    throw new Error("No DeviceLog: set current.devices in harness.create()");
  }
  return current.devices;
}

export const FAKE_DEVICES = [
  { deviceId: "mic-1", groupId: "g1", kind: "audioinput", label: "Fake Mic" },
  { deviceId: "cam-1", groupId: "g2", kind: "videoinput", label: "Fake Cam" },
  {
    deviceId: "spk-1",
    groupId: "g3",
    kind: "audiooutput",
    label: "Fake Speaker",
  },
] as unknown as MediaDeviceInfo[];

export function fakeDevice(kind: DeviceKind): MediaDeviceInfo {
  return FAKE_DEVICES[kind === "mic" ? 0 : 1];
}

let nextTrackId = 0;

/**
 * A MediaStreamTrack that captures while it is live and enabled. When
 * `reportTo` is given it keeps that DeviceLog in step, for fakes where the
 * track itself is the device (getUserMedia, livekit local tracks); fakes
 * that own the device state themselves (daily-js) leave it out.
 */
export function makeTrack(
  kind: "audio" | "video",
  reportTo?: DeviceLog
): MediaStreamTrack {
  const device: DeviceKind = kind === "audio" ? "mic" : "cam";
  const id = `fake-${kind}-${nextTrackId++}`;
  let enabled = true;
  let readyState: MediaStreamTrackState = "live";
  const report = () =>
    reportTo?.set(device, readyState === "live" && enabled, id);
  const track = {
    id,
    kind,
    label: fakeDevice(device).label,
    muted: false,
    get enabled() {
      return enabled;
    },
    set enabled(value: boolean) {
      enabled = value;
      report();
    },
    get readyState() {
      return readyState;
    },
    stop() {
      readyState = "ended";
      report();
    },
    getSettings: () => ({ deviceId: fakeDevice(device).deviceId }),
    getConstraints: () => ({}),
    getCapabilities: () => ({}),
    applyConstraints: async () => {},
    clone() {
      return makeTrack(kind, reportTo);
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    onended: null,
    onmute: null,
    onunmute: null,
  };
  report();
  return track as unknown as MediaStreamTrack;
}

export function makeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: `fake-stream-${nextTrackId++}`,
    active: true,
    getTracks: () => [...tracks],
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    addTrack: (t: MediaStreamTrack) => tracks.push(t),
    removeTrack: (t: MediaStreamTrack) => {
      const i = tracks.indexOf(t);
      if (i >= 0) tracks.splice(i, 1);
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as MediaStream;
}

function permissionError(): Error {
  const error = new Error("Permission denied");
  error.name = "NotAllowedError";
  return error;
}

/**
 * A getUserMedia that honors DeviceLog.blocked: a blocked device rejects
 * with NotAllowedError, anything else resolves with live tracks reporting
 * to the current DeviceLog.
 */
export async function fakeGetUserMedia(
  constraints: MediaStreamConstraints = {}
): Promise<MediaStream> {
  const devices = currentDevices();
  const wants: DeviceKind[] = [];
  if (constraints.audio) wants.push("mic");
  if (constraints.video) wants.push("cam");
  if (wants.some((kind) => devices.blocked[kind])) throw permissionError();
  wants.forEach((kind) => (devices.granted[kind] = true));
  return makeStream(
    wants.map((kind) => makeTrack(kind === "mic" ? "audio" : "video", devices))
  );
}

/**
 * Install navigator.mediaDevices / navigator.permissions over the current
 * DeviceLog. Returns a restore function.
 */
export function installFakeNavigatorMedia(): () => void {
  const nav = navigator as unknown as Record<string, unknown>;
  const previous = {
    mediaDevices: Object.getOwnPropertyDescriptor(nav, "mediaDevices"),
    permissions: Object.getOwnPropertyDescriptor(nav, "permissions"),
  };
  const listeners = new Set<EventListener>();
  Object.defineProperty(nav, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: fakeGetUserMedia,
      enumerateDevices: async () => FAKE_DEVICES.map((d) => ({ ...d })),
      addEventListener: (_type: string, cb: EventListener) => listeners.add(cb),
      removeEventListener: (_type: string, cb: EventListener) =>
        listeners.delete(cb),
    },
  });
  Object.defineProperty(nav, "permissions", {
    configurable: true,
    value: {
      query: async ({ name }: { name: string }) => {
        const kind: DeviceKind = name === "camera" ? "cam" : "mic";
        const devices = currentDevices();
        return {
          state: devices.blocked[kind]
            ? "denied"
            : devices.granted[kind]
              ? "granted"
              : "prompt",
          addEventListener() {},
          removeEventListener() {},
          onchange: null,
        };
      },
    },
  });
  return () => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(nav, key, descriptor);
      else delete nav[key];
    }
  };
}
