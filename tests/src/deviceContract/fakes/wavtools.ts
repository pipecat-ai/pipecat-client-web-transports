/**
 * The lib's wavtools (WavRecorder, MediaStreamRecorder, WavStreamPlayer)
 * without AudioContext / AudioWorklet, for WavMediaManager and
 * DailyMediaManager. Mock the module with:
 *
 *   vi.mock("../../../lib/src/wavtools/index.js", async () =>
 *     (await import("./fakes/wavtools")).wavtoolsModule);
 *
 * Modeled behavior, matching lib/src/wavtools/lib/*.js:
 * - WavRecorder.begin() acquires the mic through getUserMedia (the fake one
 *   in fakes/media.ts, so a blocked mic fails and reports through the device
 *   error callback, then begin() throws). The mic is on while that stream's
 *   track is live and enabled, so WavMediaManager's track.enabled toggles
 *   and end()'s track.stop() show up in the DeviceLog.
 * - begin() throws if already begun; record() / pause() / end() throw
 *   outside a begun session, record() while recording and pause() while
 *   paused, like the real recorder.
 * - listenForDeviceChange(cb) calls cb with the device list straight away
 *   (the real one does, via requestPermission + enumerateDevices).
 * - listDevices() goes through requestPermission(), which reports a device
 *   error when mic permission is denied, and when it hasn't been asked for
 *   yet acquires the mic (prompting) and releases it again, like the real
 *   recorder.
 * - MediaStreamRecorder records a track it's handed and never touches the
 *   device. WavStreamPlayer plays nothing.
 */

import { FAKE_DEVICES, fakeGetUserMedia } from "./media";

type Status = "ended" | "paused" | "recording";

class FakeRecorderBase {
  protected _status: Status = "ended";

  getStatus(): Status {
    return this._status;
  }

  getSampleRate() {
    return 16000;
  }

  async record(_chunkProcessor?: unknown, _chunkSize?: number) {
    if (this._status === "ended") {
      throw new Error("Session ended: please call .begin() first");
    }
    if (this._status === "recording") {
      throw new Error("Already recording: please call .pause() first");
    }
    this._status = "recording";
    return true;
  }

  async pause() {
    if (this._status === "ended") {
      throw new Error("Session ended: please call .begin() first");
    }
    if (this._status === "paused") {
      throw new Error("Already paused: please call .record() first");
    }
    this._status = "paused";
    return true;
  }

  getFrequencies() {
    return { values: new Float32Array(0), labels: [] };
  }
}

export class FakeWavRecorder extends FakeRecorderBase {
  stream: MediaStream | null = null;
  deviceSelection: MediaDeviceInfo | null = null;
  private _deviceErrorCallback: ((e: unknown) => void) | null = null;

  constructor(_opts?: unknown) {
    super();
  }

  listenForDeviceChange(callback: ((d: MediaDeviceInfo[]) => void) | null) {
    if (callback) {
      void this.listDevices().then((devices) => callback(devices));
    }
    return true;
  }

  listenForDeviceErrors(callback: ((e: unknown) => void) | null) {
    this._deviceErrorCallback = callback;
  }

  async requestPermission() {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    if (status.state === "denied") {
      this._deviceErrorCallback?.({
        devices: ["mic"],
        type: "unknown",
        error: new Error("Microphone access denied"),
      });
    } else if (status.state === "prompt") {
      try {
        const stream = await fakeGetUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        this._deviceErrorCallback?.({
          devices: ["mic"],
          type: "unknown",
          error,
        });
      }
    }
    return true;
  }

  async listDevices() {
    await this.requestPermission();
    return FAKE_DEVICES.filter((d) => d.kind === "audioinput").map((d) => ({
      ...d,
    })) as MediaDeviceInfo[];
  }

  async begin(_deviceId?: string) {
    if (this._status !== "ended") {
      throw new Error(
        "Already connected: please call .end() to start a new session"
      );
    }
    try {
      this.stream = await fakeGetUserMedia({ audio: true });
    } catch (err) {
      this._deviceErrorCallback?.({
        devices: ["mic"],
        type: "unknown",
        error: err,
      });
      throw new Error("Could not start media stream");
    }
    this.deviceSelection = (await this.listDevices())[0];
    this._status = "paused";
    return true;
  }

  async end() {
    if (this._status === "ended") {
      throw new Error("Session ended: please call .begin() first");
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this._status = "ended";
    return {};
  }

  async quit() {
    if (this._status !== "ended") await this.end();
    this.deviceSelection = null;
    return true;
  }
}

export class FakeMediaStreamRecorder extends FakeRecorderBase {
  constructor(_opts?: unknown) {
    super();
  }

  async begin(audioTrack?: MediaStreamTrack) {
    if (this._status !== "ended") {
      throw new Error(
        "Already connected: please call .end() to start a new session"
      );
    }
    if (!audioTrack) throw new Error("No audio track provided");
    this._status = "paused";
    return true;
  }

  async end() {
    if (this._status === "ended") {
      throw new Error("Session ended: please call .begin() first");
    }
    this._status = "ended";
    return {};
  }

  async quit() {
    if (this._status !== "ended") await this.end();
    return true;
  }
}

export class FakeWavStreamPlayer {
  constructor(_opts?: unknown) {}
  async connect() {
    return true;
  }
  async updateSpeaker(_speakerId: string) {
    return true;
  }
  add16BitPCM(data: ArrayBuffer | Int16Array) {
    return data instanceof Int16Array ? data : new Int16Array(data);
  }
  async interrupt() {
    return null;
  }
  async getTrackSampleOffset() {
    return null;
  }
  getFrequencies() {
    return { values: new Float32Array(0), labels: [] };
  }
}

export const wavtoolsModule = {
  WavRecorder: FakeWavRecorder,
  MediaStreamRecorder: FakeMediaStreamRecorder,
  WavStreamPlayer: FakeWavStreamPlayer,
  WavPacker: class {},
  AudioAnalysis: class {},
};
