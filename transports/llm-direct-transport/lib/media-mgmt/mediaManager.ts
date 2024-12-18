import { WavRecorder, WavStreamPlayer } from "../wavtools/index.js";

import {
  RTVIClientOptions,
  RTVIEventCallbacks,
  Tracks,
} from "@pipecat-ai/client-js";

export abstract class MediaManager {
  protected declare _userAudioCallback: (data: ArrayBuffer) => void;
  protected declare _options: RTVIClientOptions;
  protected declare _callbacks: RTVIEventCallbacks;

  protected _micEnabled: boolean;

  constructor() {
    this._micEnabled = true;
  }

  setUserAudioCallback(userAudioCallback: (data: ArrayBuffer) => void) {
    this._userAudioCallback = userAudioCallback;
  }
  setRTVIOptions(options: RTVIClientOptions, override: boolean = false) {
    if (this._options && !override) return;
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._micEnabled = options.enableMic ?? true;
  }

  abstract initialize(): Promise<void>;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  abstract userStartedSpeaking(): Promise<unknown>;
  abstract bufferBotAudio(
    data: ArrayBuffer | Int16Array,
    id?: string
  ): Int16Array;

  abstract getAllMics(): Promise<MediaDeviceInfo[]>;
  abstract getAllCams(): Promise<MediaDeviceInfo[]>;
  abstract getAllSpeakers(): Promise<MediaDeviceInfo[]>;

  abstract updateMic(micId: string): void;
  abstract updateCam(camId: string): void;
  abstract updateSpeaker(speakerId: string): void;

  abstract get selectedMic(): MediaDeviceInfo | Record<string, never>;
  abstract get selectedCam(): MediaDeviceInfo | Record<string, never>;
  abstract get selectedSpeaker(): MediaDeviceInfo | Record<string, never>;

  abstract enableMic(enable: boolean): void;
  abstract enableCam(enable: boolean): void;

  abstract get isCamEnabled(): boolean;
  abstract get isMicEnabled(): boolean;

  abstract tracks(): Tracks;
}

export class WavMediaManager extends MediaManager {
  private _wavRecorder;
  private _wavStreamPlayer;

  private _initialized = false;

  constructor() {
    super();
    this._wavRecorder = new WavRecorder({ sampleRate: 24000 });
    this._wavStreamPlayer = new WavStreamPlayer({ sampleRate: 24000 });
  }

  async initialize(): Promise<void> {
    await this._wavRecorder.begin();
    this._wavRecorder.listenForDeviceChange(null);
    this._wavRecorder.listenForDeviceChange(
      this._handleAvailableDevicesUpdated.bind(this)
    );
    await this._wavStreamPlayer.connect();
    this._initialized = true;
  }

  async connect(): Promise<void> {
    if (!this._initialized) {
      await this.initialize();
    }
    if (this._micEnabled) {
      await this._startRecording();
    }
  }

  async disconnect(): Promise<void> {
    await this._wavRecorder.end();
    await this._wavStreamPlayer.interrupt();
    this._initialized = false;
  }

  async userStartedSpeaking(): Promise<unknown> {
    return this._wavStreamPlayer.interrupt();
  }

  bufferBotAudio(data: ArrayBuffer | Int16Array, id?: string): Int16Array {
    return this._wavStreamPlayer.add16BitPCM(data, id);
  }

  getAllMics(): Promise<MediaDeviceInfo[]> {
    return this._wavRecorder.listDevices();
  }
  getAllCams(): Promise<MediaDeviceInfo[]> {
    // TODO: Video not supported yet
    return Promise.resolve([]);
  }
  getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    // TODO: Implement speaker support
    return Promise.resolve([]);
  }

  async updateMic(micId: string): Promise<void> {
    const prevMic = this._wavRecorder.deviceSelection;
    await this._wavRecorder.end();
    await this._wavRecorder.begin(micId);
    if (this._micEnabled) {
      await this._startRecording();
    }
    const curMic = this._wavRecorder.deviceSelection;
    if (curMic && prevMic && prevMic.label !== curMic.label) {
      this._callbacks.onMicUpdated?.(curMic);
    }
  }

  updateCam(camId: string): void {
    // TODO: Video not supported yet
  }
  updateSpeaker(speakerId: string): void {
    // TODO: Implement speaker support
  }

  get selectedMic(): MediaDeviceInfo | Record<string, never> {
    return this._wavRecorder.deviceSelection ?? {};
  }
  get selectedCam(): MediaDeviceInfo | Record<string, never> {
    // TODO: Video not supported yet
    return {};
  }
  get selectedSpeaker(): MediaDeviceInfo | Record<string, never> {
    // TODO: Implement speaker support
    return {};
  }

  async enableMic(enable: boolean): Promise<void> {
    this._micEnabled = enable;
    if (!this._wavRecorder.stream) return;
    this._wavRecorder.stream
      .getAudioTracks()
      .forEach((track: MediaStreamTrack) => {
        track.enabled = enable;
        if (!enable) {
          this._callbacks.onTrackStopped?.(track, localParticipant());
        }
      });
    if (enable) {
      await this._startRecording();
    } else {
      await this._wavRecorder.pause();
    }
  }
  enableCam(enable: boolean): void {
    // TODO: Video not supported yet
  }

  get isCamEnabled(): boolean {
    // TODO: Video not supported yet
    return false;
  }
  get isMicEnabled(): boolean {
    return this._micEnabled;
  }

  tracks(): Tracks {
    const tracks = this._wavRecorder.stream?.getTracks()[0];
    return { local: tracks ? { audio: tracks } : {} };
  }

  private async _startRecording() {
    await this._wavRecorder.record((data) => {
      this._userAudioCallback(data.mono);
    });
    const track = this._wavRecorder.stream?.getAudioTracks()[0];
    if (track) {
      this._callbacks.onTrackStarted?.(track, localParticipant());
    }
  }

  private _handleAvailableDevicesUpdated(devices: MediaDeviceInfo[]) {
    this._callbacks.onAvailableCamsUpdated?.(
      devices.filter((d) => d.kind === "videoinput")
    );
    this._callbacks.onAvailableMicsUpdated?.(
      devices.filter((d) => d.kind === "audioinput")
    );
    // if the current device went away or we're using the default and
    // the default changed, reset the mic.
    const defaultDevice = devices.find((d) => d.deviceId === "default");
    const currentDevice = this._wavRecorder.deviceSelection;
    if (
      currentDevice &&
      (!devices.some((d) => d.deviceId === currentDevice.deviceId) ||
        (currentDevice.deviceId === "default" &&
          currentDevice.label !== defaultDevice?.label))
    ) {
      this.updateMic("");
    }
  }
}

const localParticipant = () => {
  return {
    id: "local",
    name: "",
    local: true,
  };
};
