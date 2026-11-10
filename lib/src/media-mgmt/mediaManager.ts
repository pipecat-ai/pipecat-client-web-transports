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

  // Live state of each device, what isMicEnabled / isCamEnabled report.
  protected _micEnabled: boolean;
  protected _camEnabled: boolean;
  // Connect-time flags: the state each device should be in when a session
  // starts. Outside a session enableMic() / enableCam() update them along
  // with the live state, so the next connect() lands on what the app last
  // asked for. Once connect() begins they are frozen and only the live
  // state changes, so a mid-session mute does not leak into the next
  // connect(). disconnect() resets the live state to them.
  protected _micEnabledOnConnect: boolean;
  protected _camEnabledOnConnect: boolean;

  protected _supportsScreenShare: boolean;

  constructor() {
    this._micEnabled = true;
    this._camEnabled = false;
    this._micEnabledOnConnect = true;
    this._camEnabledOnConnect = false;
    this._supportsScreenShare = false;
  }

  setUserAudioCallback(userAudioCallback: (data: ArrayBuffer) => void) {
    this._userAudioCallback = userAudioCallback;
  }
  setClientOptions(options: PipecatClientOptions, override: boolean = false) {
    if (this._options && !override) return;
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._micEnabledOnConnect = options.enableMic ?? true;
    this._camEnabledOnConnect = options.enableCam ?? false;
    this._micEnabled = this._micEnabledOnConnect;
    this._camEnabled = this._camEnabledOnConnect;
  }

  /**
   * Record a toggle: always record the live state always
   * and record the connect-time flag only outside a session.
   */
  protected _recordEnable(
    kind: "mic" | "cam",
    enable: boolean,
    inSession: boolean
  ) {
    if (kind === "mic") {
      this._micEnabled = enable;
      if (!inSession) this._micEnabledOnConnect = enable;
    } else {
      this._camEnabled = enable;
      if (!inSession) this._camEnabledOnConnect = enable;
    }
  }

  /**
   * Nothing is running after a disconnect, so the live mic / cam state goes
   * back to the connect-time flags, i.e. what the next connect() will do.
   */
  protected _resetDeviceFlags() {
    this._micEnabled = this._micEnabledOnConnect;
    this._camEnabled = this._camEnabledOnConnect;
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

  protected _reportDeviceError(kind: "mic" | "cam", e: unknown) {
    console.error(`Failed to start ${kind}`, e);
    this._callbacks.onDeviceError?.(
      new DeviceError(
        [kind],
        "unknown",
        e instanceof Error ? e.message : String(e)
      )
    );
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

  private _initialized = false;
  private _initPromise: Promise<void> | null = null;
  private _connected = false;
  private _recorderChunkSize: number | undefined = undefined;

  constructor(
    recorderChunkSize: number | undefined = undefined,
    recorderSampleRate: number | undefined = 24000
  ) {
    super();
    this._recorderChunkSize = recorderChunkSize;
    this._wavRecorder = new WavRecorder({ sampleRate: recorderSampleRate });
    this._wavStreamPlayer = new WavStreamPlayer({ sampleRate: 24000 });
  }

  /** Captures the microphone only. */
  get mediaSupport(): CaptureSupport {
    return { mic: true, cam: false, screenShare: false };
  }

  // Set up the recorder and player for this session, acquiring the mic when
  // it is enabled. Safe to call any number of times: once initialized it is
  // a no-op, and concurrent callers share one call.
  async initialize(): Promise<void> {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInitialize().finally(() => {
      this._initPromise = null;
    });
    return this._initPromise;
  }

  private async _doInitialize(): Promise<void> {
    // Listen before acquiring, so a blocked or missing mic on the first
    // begin() is reported as a DeviceError rather than lost.
    this._wavRecorder.listenForDeviceChange(null);
    this._wavRecorder.listenForDeviceChange(
      this._handleAvailableDevicesUpdated.bind(this)
    );
    this._wavRecorder.listenForDeviceErrors(null);
    this._wavRecorder.listenForDeviceErrors(this._handleDeviceError.bind(this));
    if (this._micEnabled) {
      await this._acquireMic();
    }
    await this._wavStreamPlayer.connect();
    this._initialized = true;
  }

  // Acquire the mic (getUserMedia, via the recorder). A failure is reported
  // through the recorder's device-error listener, so it is swallowed here;
  // the next enableMic(true) re-attempts.
  private async _acquireMic(): Promise<void> {
    if (this._wavRecorder.stream) return;
    try {
      await this._wavRecorder.begin();
    } catch (error) {
      return;
    }
    this._reportLocalTrack();
  }

  private _reportLocalTrack() {
    const track = this._wavRecorder.stream?.getAudioTracks()[0];
    if (track) {
      this._callbacks.onTrackStarted?.(track, localParticipant());
      this._onTrackStarted?.(track, "audio");
    }
  }

  async connect(): Promise<void> {
    // From here the connect-time flags are frozen for the session.
    this._connected = true;
    if (!this._initialized) {
      await this.initialize();
    }
    if (this._micEnabled) {
      await this._acquireMic();
      await this._startRecording();
    }
    if (this._camEnabled) {
      console.warn("WavMediaManager does not support video input.");
    }
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    if (!this._initialized) {
      return;
    }
    if (this._wavRecorder.stream) {
      await this._wavRecorder.end();
    }
    await this._wavStreamPlayer.interrupt();
    this._initialized = false;
    this._resetDeviceFlags();
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
    if (this._wavRecorder.getStatus() !== "ended") {
      await this._wavRecorder.end();
    }
    try {
      await this._wavRecorder.begin(micId);
      if (this._micEnabled) {
        this._reportLocalTrack();
        await this._startRecording();
      }
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
    this._recordEnable("mic", enable, this._connected);
    if (!enable) {
      this._wavRecorder.stream
        ?.getAudioTracks()
        .forEach((track: MediaStreamTrack) => {
          track.enabled = false;
          this._callbacks.onTrackStopped?.(track, localParticipant());
          this._onTrackStopped?.(track, "audio");
        });
      if (this._wavRecorder.getStatus() === "recording") {
        await this._wavRecorder.pause();
      }
      return;
    }
    // Enabling acquires the mic when nothing is acquired yet, whether that is
    // because nothing has been initialized, the mic started off, or the last
    // attempt failed (blocked): this is the retry path.
    if (!this._wavRecorder.stream) {
      try {
        await this.initialize();
        await this._acquireMic();
      } catch (e) {
        this._reportDeviceError("mic", e);
      }
    } else {
      this._wavRecorder.stream
        .getAudioTracks()
        .forEach((track: MediaStreamTrack) => {
          track.enabled = true;
        });
      this._reportLocalTrack();
    }
    await this._startRecording();
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

  // Recording (feeding user audio to the transport) is a session thing: it
  // starts on connect() and only while the recorder has a mic to record.
  private async _startRecording() {
    if (!this._connected || this._wavRecorder.getStatus() !== "paused") return;
    await this._wavRecorder.record((data) => {
      this._userAudioCallback?.(data.mono);
    }, this._recorderChunkSize);
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
