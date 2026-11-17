import { WavRecorder, WavStreamPlayer } from "../wavtools";

import {
  DeviceError,
  DeviceErrorType,
  MediaSupport,
  PipecatClientOptions,
  RTVIEventCallbacks,
  Tracks,
} from "@pipecat-ai/client-js";

/** The kinds of media a media manager can capture from the user. */
export type CaptureSupport = Pick<MediaSupport, "mic" | "cam" | "screenShare">;

/** Which of the user's tracks a media manager is reporting. */
export type LocalTrackType = "audio" | "video" | "screenAudio" | "screenVideo";
export type LocalTrackCallback = (
  track: MediaStreamTrack,
  type: LocalTrackType
) => void;
const LOCAL_TRACK_TYPES: readonly string[] = [
  "audio",
  "video",
  "screenAudio",
  "screenVideo",
];
export const isLocalTrackType = (type: string): type is LocalTrackType =>
  LOCAL_TRACK_TYPES.includes(type);

export abstract class MediaManager {
  declare protected _userAudioCallback: (data: ArrayBuffer) => void;
  declare protected _options: PipecatClientOptions;
  protected _callbacks: RTVIEventCallbacks = {};
  // The transport's own track listeners, separate from the client callbacks
  // above; both fire for every local track event.
  protected _onTrackStarted?: LocalTrackCallback;
  protected _onTrackStopped?: LocalTrackCallback;

  protected _micEnabled: boolean;
  protected _camEnabled: boolean;

  protected _supportsScreenShare: boolean;

  constructor() {
    this._micEnabled = true;
    this._camEnabled = false;
    this._supportsScreenShare = false;
  }

  setUserAudioCallback(userAudioCallback: (data: ArrayBuffer) => void) {
    this._userAudioCallback = userAudioCallback;
  }
  setClientOptions(options: PipecatClientOptions, override: boolean = false) {
    if (this._options && !override) return;
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._micEnabled = options.enableMic ?? true;
    this._camEnabled = options.enableCam ?? false;
  }

  /**
   * Register the transport's listeners for the user's tracks. These are kept
   * apart from the client callbacks given to setClientOptions(), and both
   * fire. A transport that sends the tracks itself uses them to pick up a
   * track acquired after connect(), e.g. enableMic(true) with the mic
   * started off.
   */
  registerTrackCallbacks(
    onTrackStarted?: LocalTrackCallback,
    onTrackStopped?: LocalTrackCallback
  ) {
    this._onTrackStarted = onTrackStarted;
    this._onTrackStopped = onTrackStopped;
  }

  abstract initialize(): Promise<void>;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  /**
   * Stop bot audio playback and discard any buffered bot audio, e.g. when
   * the bot has been interrupted.
   */
  abstract interruptBotAudio(): Promise<unknown>;

  abstract bufferBotAudio(
    data: ArrayBuffer | Int16Array,
    id?: string
  ): Int16Array | undefined;

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
  abstract enableScreenShare(enable: boolean): void;

  abstract get isCamEnabled(): boolean;
  abstract get isMicEnabled(): boolean;
  abstract get isSharingScreen(): boolean;

  abstract tracks(): Tracks;

  get supportsScreenShare(): boolean {
    return this._supportsScreenShare;
  }

  /**
   * The kinds of media this media manager can capture, for the transport's
   * `mediaSupport`. `false` rules a kind out, and a missing key leaves it unknown.
   * By default only screen share can be ruled out: `screenShare` is `false` when
   * `supportsScreenShare` is, because this media manager or the browser can't
   * share the screen. Media managers that know more override this.
   */
  get mediaSupport(): CaptureSupport {
    return this._supportsScreenShare ? {} : { screenShare: false };
  }
}

export class WavMediaManager extends MediaManager {
  private _wavRecorder;
  private _wavStreamPlayer;

  private _connected = false;
  private _recorderChunkSize: number | undefined = undefined;
  private _listeningForDevices = false;
  private _micStarted: Promise<unknown> | null = null;
  private _playerStarted: Promise<void> | null = null;
  // A blocked mic is reported both by begin() and by every device listing
  // after it, so once it's reported, hold further mic errors until the next
  // device call or until the mic starts.
  private _micErrorReported = false;
  // The mic track onTrackStarted was last fired for, so a new track (from
  // begin()) or a re-enabled one fires it, and a disabled one onTrackStopped.
  private _startedTrack: MediaStreamTrack | null = null;

  constructor(
    recorderChunkSize: number | undefined = undefined,
    recorderSampleRate: number | undefined = 24000
  ) {
    super();
    this._recorderChunkSize = recorderChunkSize;
    this._wavRecorder = new WavRecorder({ sampleRate: recorderSampleRate });
    this._wavStreamPlayer = new WavStreamPlayer({ sampleRate: 24000 });
    this._wavRecorder.listenForDeviceErrors(this._handleDeviceError.bind(this));
  }

  /** Captures the microphone only. */
  get mediaSupport(): CaptureSupport {
    return { mic: true, cam: false, screenShare: false };
  }

  async initialize(): Promise<void> {
    this._micErrorReported = false;
    this._micEnabled = this._options?.enableMic ?? true;
    this._listenForDevices();
    await Promise.all([
      this._micEnabled ? this._startMic() : undefined,
      this._startPlayer(),
    ]);
  }

  async connect(): Promise<void> {
    this._connected = true;
    // The mic stays as initialize() / enableMic() left it; connect() only
    // starts recording it.
    await this._startPlayer();
    await this._syncMic();
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this._micEnabled = false;
    this._playerStarted = null;
    if (this._wavRecorder.getStatus() !== "ended") {
      await this._wavRecorder.end();
    }
    await this._wavStreamPlayer.interrupt();
  }

  async interruptBotAudio(): Promise<unknown> {
    return this._wavStreamPlayer.interrupt();
  }

  bufferBotAudio(
    data: ArrayBuffer | Int16Array,
    id?: string
  ): Int16Array | undefined {
    return this._wavStreamPlayer.add16BitPCM(data, id);
  }

  async getAllMics(): Promise<MediaDeviceInfo[]> {
    // Not the recorder's listDevices(): that asks for mic permission first,
    // and listing devices shouldn't prompt. Until permission is granted the
    // labels are blank, as with any enumerateDevices().
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
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
    this._micErrorReported = false;
    const prevMic = this._wavRecorder.deviceSelection;
    if (this._wavRecorder.getStatus() !== "ended") {
      await this._wavRecorder.end();
    }
    try {
      await this._wavRecorder.begin(micId);
      await this._syncMic();
      const curMic = this._wavRecorder.deviceSelection;
      if (curMic && prevMic && prevMic.label !== curMic.label) {
        this._callbacks.onMicUpdated?.(curMic);
      }
    } catch (error) {
      // void. If begin() fails, it will have already logged and called
      // onDeviceError if necessary.
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
    if (enable) {
      this._micErrorReported = false;
      this._listenForDevices();
      await this._startMic();
    } else {
      await this._syncMic();
    }
  }
  enableCam(enable: boolean): void {
    // TODO: Video not supported yet
    console.warn("WavMediaManager does not support video input.");
  }
  enableScreenShare(enable: boolean): void {
    // TODO: Screensharing not supported yet
    console.warn("WavMediaManager does not support screen sharing.");
  }

  get isCamEnabled(): boolean {
    // TODO: Video not supported yet
    return false;
  }
  get isMicEnabled(): boolean {
    return this._micEnabled;
  }
  get isSharingScreen(): boolean {
    // TODO: Screensharing not supported yet
    return false;
  }

  tracks(): Tracks {
    const tracks = this._wavRecorder.stream?.getTracks()[0];
    return { local: tracks ? { audio: tracks } : {} };
  }

  /**
   * Acquire the mic if it isn't already, then bring it in line with
   * _micEnabled, which a call made while it was starting may have changed.
   * Concurrent callers share the one begin(). A blocked mic has already been
   * reported by the recorder, and stays off.
   */
  private async _startMic(): Promise<void> {
    if (this._wavRecorder.getStatus() === "ended") {
      this._micStarted ??= this._wavRecorder.begin();
      try {
        await this._micStarted;
        this._micErrorReported = false;
      } catch {
        // void. begin() has already reported it through onDeviceError.
      } finally {
        this._micStarted = null;
      }
    }
    await this._syncMic();
  }

  /**
   * Make the mic track and the recorder match _micEnabled: the track enabled
   * or not, and recording only while connected.
   */
  private async _syncMic(): Promise<void> {
    const track = this._wavRecorder.stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = this._micEnabled;
    if (this._micEnabled && this._startedTrack !== track) {
      this._startedTrack = track;
      this._callbacks.onTrackStarted?.(track, localParticipant());
      this._onTrackStarted?.(track, "audio");
    } else if (!this._micEnabled && this._startedTrack === track) {
      this._startedTrack = null;
      this._callbacks.onTrackStopped?.(track, localParticipant());
      this._onTrackStopped?.(track, "audio");
    }
    const status = this._wavRecorder.getStatus();
    if (this._micEnabled && this._connected && status === "paused") {
      await this._wavRecorder.record((data) => {
        this._userAudioCallback?.(data.mono);
      }, this._recorderChunkSize);
    } else if (!this._micEnabled && status === "recording") {
      await this._wavRecorder.pause();
    }
  }

  /** Get the bot-audio player ready, once per session. */
  private _startPlayer(): Promise<void> {
    this._playerStarted ??= this._wavStreamPlayer.connect().then(() => {});
    return this._playerStarted;
  }

  private _listenForDevices() {
    if (this._listeningForDevices) return;
    this._listeningForDevices = true;
    this._wavRecorder.listenForDeviceChange(
      this._handleAvailableDevicesUpdated.bind(this)
    );
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

  private _handleDeviceError({
    devices,
    type,
    error,
  }: {
    devices: Array<"cam" | "mic">;
    type: DeviceErrorType;
    error?: Error;
  }) {
    if (devices.length === 1 && devices[0] === "mic") {
      if (this._micErrorReported) return;
      this._micErrorReported = true;
    }
    const deviceError = new DeviceError(
      devices,
      type,
      error?.message,
      error ? { sourceError: error } : undefined
    );
    this._callbacks.onDeviceError?.(deviceError);
  }
}

const localParticipant = () => {
  return {
    id: "local",
    name: "",
    local: true,
  };
};
