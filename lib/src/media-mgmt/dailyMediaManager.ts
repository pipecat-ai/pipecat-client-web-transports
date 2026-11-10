import { browserSupportsScreenShare } from "./browserSupport";
import { CaptureSupport, isLocalTrackType, MediaManager } from "./mediaManager";
import { MediaStreamRecorder, WavStreamPlayer } from "../wavtools";

import Daily, {
  DailyCall,
  DailyCameraErrorObject,
  DailyCameraErrorType,
  DailyEventObjectAvailableDevicesUpdated,
  DailyEventObjectCameraError,
  DailyEventObjectLocalAudioLevel,
  DailyEventObjectSelectedDevicesUpdated,
  DailyEventObjectTrack,
  DailyParticipant,
  DailyParticipantsObject,
} from "@daily-co/daily-js";
import {
  DeviceArray,
  DeviceError,
  Participant,
  Tracks,
} from "@pipecat-ai/client-js";

export class DailyMediaManager extends MediaManager {
  private _daily: DailyCall;
  private _mediaStreamRecorder: MediaStreamRecorder | undefined;
  private _wavStreamPlayer: WavStreamPlayer | undefined;

  // Whether daily-js's media resources are available: startCamera() has
  // resolved and leave() has not run since. Outside of this state
  // setLocalAudio() / setLocalVideo() don't do anything. This
  // manager never join()s a Daily call; the call object is only a device
  // layer, and leave() is used to release its resources.
  private _initialized: boolean;
  private _initPromise: Promise<void> | null = null;
  private _connected: boolean;

  private _currentAudioTrack: MediaStreamTrack | null;
  private _selectedCam: MediaDeviceInfo | Record<string, never> = {};
  private _selectedMic: MediaDeviceInfo | Record<string, never> = {};
  private _selectedSpeaker: MediaDeviceInfo | Record<string, never> = {};

  private _remoteAudioLevelInterval: NodeJS.Timeout | null = null;

  private _recorderChunkSize: number | undefined = undefined;

  constructor(
    enablePlayer: boolean = true,
    enableRecording: boolean = true,
    recorderChunkSize: number | undefined = undefined,
    recorderSampleRate: number = 24000,
    playerSampleRate: number = 24000
  ) {
    super();
    this._initialized = false;
    this._connected = false;
    this._currentAudioTrack = null;
    this._recorderChunkSize = recorderChunkSize;

    this._supportsScreenShare = browserSupportsScreenShare();

    this._daily = Daily.getCallInstance() ?? Daily.createCallObject();

    if (enableRecording) {
      this._mediaStreamRecorder = new MediaStreamRecorder({
        sampleRate: recorderSampleRate,
      });
    }
    if (enablePlayer) {
      this._wavStreamPlayer = new WavStreamPlayer({
        sampleRate: playerSampleRate,
      });
    }

    this._daily.on("track-started", this.handleTrackStarted.bind(this));
    this._daily.on("track-stopped", this.handleTrackStopped.bind(this));
    this._daily.on(
      "available-devices-updated",
      this._handleAvailableDevicesUpdated.bind(this)
    );
    this._daily.on(
      "selected-devices-updated",
      this._handleSelectedDevicesUpdated.bind(this)
    );
    this._daily.on("camera-error", this.handleDeviceError.bind(this));
    this._daily.on("local-audio-level", this._handleLocalAudioLevel.bind(this));
  }

  // Start daily-js media for this session (the once-per-session
  // startCamera()) and report the devices. Safe to call any number of
  // times: with media already running it is a no-op, and concurrent callers
  // share one call.
  async initialize(): Promise<void> {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._startMedia().finally(() => {
      this._initPromise = null;
    });
    return this._initPromise;
  }

  private async _startMedia(): Promise<void> {
    const requested = { mic: this._micEnabled, cam: this._camEnabled };
    const infos = await this._daily.startCamera({
      startVideoOff: !this._camEnabled,
      startAudioOff: !this._micEnabled,
      dailyConfig: { useDevicePreferenceCookies: true },
    });
    this._initialized = true;
    // Toggles that arrived while startCamera() was in flight had nothing to
    // apply to; apply them now that media is running.
    if (this._micEnabled !== requested.mic) {
      this._daily.setLocalAudio(this._micEnabled);
    }
    if (this._camEnabled !== requested.cam) {
      this._daily.setLocalVideo(this._camEnabled);
    }
    const { devices } = await this._daily.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");
    const mics = devices.filter((d) => d.kind === "audioinput");
    const speakers = devices.filter((d) => d.kind === "audiooutput");
    this._callbacks.onAvailableCamsUpdated?.(cams);
    this._callbacks.onAvailableMicsUpdated?.(mics);
    this._callbacks.onAvailableSpeakersUpdated?.(speakers);
    this._selectedCam = infos.camera;
    this._callbacks.onCamUpdated?.(infos.camera as MediaDeviceInfo);
    this._selectedMic = infos.mic;
    this._callbacks.onMicUpdated?.(infos.mic as MediaDeviceInfo);
    this._selectedSpeaker = infos.speaker;
    this._callbacks.onSpeakerUpdated?.(infos.speaker as MediaDeviceInfo);

    // Instantiate audio observers
    if (!this._daily.isLocalAudioLevelObserverRunning())
      await this._daily.startLocalAudioLevelObserver(100);

    if (this._wavStreamPlayer) {
      await this._wavStreamPlayer.connect();
      if (!this._remoteAudioLevelInterval) {
        this._remoteAudioLevelInterval = setInterval(() => {
          const frequencies = this._wavStreamPlayer!.getFrequencies();
          let aveVal = 0;
          if (frequencies.values?.length) {
            aveVal =
              frequencies.values.reduce((a, c) => a + c, 0) /
              frequencies.values.length;
          }
          this._handleRemoteAudioLevel(aveVal);
        }, 100);
      }
    }
  }

  async connect(): Promise<void> {
    if (this._connected) {
      console.warn("DailyMediaManager already connected");
      return;
    }
    // From here the connect-time flags are frozen for the session.
    this._connected = true;
    if (!this._initialized) {
      await this.initialize();
    }
    // With the recorder already holding the local audio track, record now.
    // Otherwise handleTrackStarted begins the recorder and starts recording
    // when daily-js reports the track.
    if (this._micEnabled) {
      this._startRecording();
    }
  }

  async disconnect(): Promise<void> {
    if (this._remoteAudioLevelInterval) {
      clearInterval(this._remoteAudioLevelInterval);
    }
    this._remoteAudioLevelInterval = null;
    this._daily.leave();
    this._currentAudioTrack = null;
    if (this._mediaStreamRecorder?.getStatus() !== "ended") {
      await this._mediaStreamRecorder?.end();
    }
    this._wavStreamPlayer?.interrupt();
    // leave() tears down daily-js media. The next session starts from the
    // connect-time flags again, so the live state goes back to them.
    this._initialized = false;
    this._connected = false;
    this._resetDeviceFlags();
  }

  async interruptBotAudio(): Promise<unknown> {
    return this._wavStreamPlayer?.interrupt();
  }

  bufferBotAudio(
    data: ArrayBuffer | Int16Array,
    id?: string
  ): Int16Array | undefined {
    return this._wavStreamPlayer?.add16BitPCM(data, id);
  }

  async getAllMics(): Promise<MediaDeviceInfo[]> {
    let devices = (await this._daily.enumerateDevices()).devices;
    return devices.filter((device) => device.kind === "audioinput");
  }
  async getAllCams(): Promise<MediaDeviceInfo[]> {
    let devices = (await this._daily.enumerateDevices()).devices;
    return devices.filter((device) => device.kind === "videoinput");
  }
  async getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    let devices = (await this._daily.enumerateDevices()).devices;
    return devices.filter((device) => device.kind === "audiooutput");
  }

  updateMic(micId: string) {
    this._daily
      .setInputDevicesAsync({ audioDeviceId: micId })
      .then((deviceInfo) => {
        this._selectedMic = deviceInfo.mic;
      });
  }
  updateCam(camId: string) {
    this._daily
      .setInputDevicesAsync({ videoDeviceId: camId })
      .then((deviceInfo) => {
        this._selectedCam = deviceInfo.camera;
      });
  }
  async updateSpeaker(speakerId: string): Promise<void> {
    if (!this._wavStreamPlayer) {
      try {
        const dInfo = await this._daily.setOutputDeviceAsync({
          outputDeviceId: speakerId,
        });
        this._selectedSpeaker = dInfo.speaker as MediaDeviceInfo;
        this._callbacks.onSpeakerUpdated?.(this._selectedSpeaker);
      } catch (e) {
        console.error("Error setting output device", e);
      }
      return;
    }

    if (speakerId !== "default" && this._selectedSpeaker.deviceId === speakerId)
      return;

    let sID = speakerId;
    if (sID === "default") {
      const speakers = await this.getAllSpeakers();
      const defaultSpeaker = speakers.find((s) => s.deviceId === "default");
      if (!defaultSpeaker) {
        console.warn("No default speaker found");
        return;
      }
      speakers.splice(speakers.indexOf(defaultSpeaker), 1);
      const defaultSpeakerCp = speakers.find((s) =>
        defaultSpeaker.label.includes(s.label)
      );
      sID = defaultSpeakerCp?.deviceId ?? speakerId;
    }
    this._wavStreamPlayer?.updateSpeaker(sID).then(() => {
      this._selectedSpeaker = { deviceId: speakerId } as MediaDeviceInfo;
      this._callbacks.onSpeakerUpdated?.(this._selectedSpeaker);
    });
  }

  get selectedMic(): MediaDeviceInfo | Record<string, never> {
    return this._selectedMic;
  }
  get selectedCam(): MediaDeviceInfo | Record<string, never> {
    return this._selectedCam;
  }
  get selectedSpeaker(): MediaDeviceInfo | Record<string, never> {
    return this._selectedSpeaker;
  }

  async enableMic(enable: boolean): Promise<void> {
    this._recordEnable("mic", enable, this._connected);
    if (!this._initialized) {
      this._acquireOnEnable("mic", enable);
      return;
    }
    this._daily.setLocalAudio(enable);
    if (this._mediaStreamRecorder) {
      if (enable) {
        if (this._mediaStreamRecorder.getStatus() === "paused") {
          this._startRecording();
        } // else, we'll record on the track-started event
      } else {
        if (this._mediaStreamRecorder.getStatus() === "recording") {
          this._mediaStreamRecorder.pause();
        }
      }
    }
  }
  enableCam(enable: boolean): void {
    this._recordEnable("cam", enable, this._connected);
    if (!this._initialized) {
      this._acquireOnEnable("cam", enable);
      return;
    }
    this._daily.setLocalVideo(enable);
  }

  // With nothing running, enabling starts media (per the live state, which
  // the toggle just set), which is also what re-attempts a blocked device:
  // daily-js re-fires camera-error if it is still blocked. Disabling only
  // records the preference; it never prompts for a device the app has turned
  // off. While connect() is initializing, or a start is already in flight,
  // that call applies the toggle once it resolves.
  private _acquireOnEnable(kind: "mic" | "cam", enable: boolean) {
    if (!enable || this._connected) return;
    this.initialize().catch((e) => this._reportDeviceError(kind, e));
  }
  enableScreenShare(enable: boolean): void {
    if (enable) {
      this._daily.startScreenShare();
    } else {
      this._daily.stopScreenShare();
    }
  }

  // NOTE: deliberately not `this._daily.localVideo()` / `localAudio()`. Daily
  // fires 'track-started'/'track-stopped' *before* it commits the new state
  // to the participant object those getters read from (see daily-js's
  // DAILY_EVENT_PARTICIPANT_UPDATED handling: maybeEventTrackStopped/Started
  // run, then `this._participants[id]` is reassigned). Callers that react to
  // TrackStarted/TrackStopped by reading isCamEnabled/isMicEnabled — e.g. to
  // resync UI state — would otherwise always observe the pre-toggle value.
  // _camEnabled/_micEnabled are updated synchronously in
  // handleTrackStarted/handleTrackStopped below, before those callbacks fire.
  get isCamEnabled(): boolean {
    return this._camEnabled;
  }
  get isMicEnabled(): boolean {
    return this._micEnabled;
  }

  /** Captures the microphone, the camera and, where the browser can, the screen. */
  get mediaSupport(): CaptureSupport {
    return { mic: true, cam: true, screenShare: this._supportsScreenShare };
  }

  get isSharingScreen(): boolean {
    return this._daily.localScreenAudio() || this._daily.localScreenVideo();
  }

  tracks(): Tracks {
    const participants: DailyParticipantsObject = this._daily.participants();
    return {
      local: {
        audio: participants?.local?.tracks?.audio?.persistentTrack,
        screenAudio: participants?.local?.tracks?.screenAudio?.persistentTrack,
        screenVideo: participants?.local?.tracks?.screenVideo?.persistentTrack,
        video: participants?.local?.tracks?.video?.persistentTrack,
      },
    };
  }

  private _startRecording(): void {
    if (!this._connected || !this._mediaStreamRecorder) return;
    // Nothing to record until handleTrackStarted has begun the recorder.
    if (this._mediaStreamRecorder.getStatus() === "ended") return;
    try {
      this._mediaStreamRecorder.record((data) => {
        this._userAudioCallback(data.mono);
      }, this._recorderChunkSize);
    } catch (e) {
      const err = e as Error;
      if (!err.message.includes("Already recording")) {
        console.error("Error starting recording", e);
      }
    }
  }

  private _handleAvailableDevicesUpdated(
    event: DailyEventObjectAvailableDevicesUpdated
  ) {
    this._callbacks.onAvailableCamsUpdated?.(
      event.availableDevices.filter((d) => d.kind === "videoinput")
    );
    this._callbacks.onAvailableMicsUpdated?.(
      event.availableDevices.filter((d) => d.kind === "audioinput")
    );
    this._callbacks.onAvailableSpeakersUpdated?.(
      event.availableDevices.filter((d) => d.kind === "audiooutput")
    );
    if (this._selectedSpeaker.deviceId === "default") {
      this.updateSpeaker("default");
    }
  }

  private _handleSelectedDevicesUpdated(
    event: DailyEventObjectSelectedDevicesUpdated
  ) {
    if (this._selectedCam?.deviceId !== event.devices.camera) {
      this._selectedCam = event.devices.camera;
      this._callbacks.onCamUpdated?.(event.devices.camera as MediaDeviceInfo);
    }
    if (this._selectedMic?.deviceId !== event.devices.mic) {
      this._selectedMic = event.devices.mic;
      this._callbacks.onMicUpdated?.(event.devices.mic as MediaDeviceInfo);
    }
  }

  private handleDeviceError(ev: DailyEventObjectCameraError) {
    const generateDeviceError = (
      error: DailyCameraErrorObject<DailyCameraErrorType>
    ) => {
      const devices: DeviceArray = [];
      switch (error.type) {
        case "permissions": {
          error.blockedMedia.forEach((d) => {
            devices.push(d === "video" ? "cam" : "mic");
          });
          return new DeviceError(devices, error.type, error.msg, {
            blockedBy: error.blockedBy,
          });
        }
        case "not-found": {
          error.missingMedia.forEach((d) => {
            devices.push(d === "video" ? "cam" : "mic");
          });
          return new DeviceError(devices, error.type, error.msg);
        }
        case "constraints": {
          error.failedMedia.forEach((d) => {
            devices.push(d === "video" ? "cam" : "mic");
          });
          return new DeviceError(devices, error.type, error.msg, {
            reason: error.reason,
          });
        }
        case "cam-in-use": {
          devices.push("cam");
          return new DeviceError(devices, "in-use", error.msg);
        }
        case "mic-in-use": {
          devices.push("mic");
          return new DeviceError(devices, "in-use", error.msg);
        }
        case "cam-mic-in-use": {
          devices.push("cam");
          devices.push("mic");
          return new DeviceError(devices, "in-use", error.msg);
        }
        case "undefined-mediadevices":
        case "unknown":
        default: {
          devices.push("cam");
          devices.push("mic");
          return new DeviceError(devices, error.type, error.msg);
        }
      }
    };
    const deviceError = generateDeviceError(ev.error);
    // enableMic()/enableCam() set _micEnabled/_camEnabled optimistically,
    // but setLocalAudio()/setLocalVideo() are fire-and-forget — no promise,
    // no synchronous failure signal — so a failed request (blocked
    // permission, device in use, etc.) leaves that optimistic value wrong
    // with nothing to correct it: no track-started/stopped ever fires for
    // an operation that didn't actually take effect. This is the only
    // signal we get that the request failed, so resync from Daily's actual
    // state for whichever device(s) it implicates.
    if (deviceError.devices.includes("mic")) {
      this._micEnabled = this._daily.localAudio();
    }
    if (deviceError.devices.includes("cam")) {
      this._camEnabled = this._daily.localVideo();
    }
    this._callbacks.onDeviceError?.(deviceError);
  }

  private _handleLocalAudioLevel(ev: DailyEventObjectLocalAudioLevel) {
    this._callbacks.onLocalAudioLevel?.(ev.audioLevel);
  }

  private _handleRemoteAudioLevel(audioLevel: number) {
    this._callbacks.onRemoteAudioLevel?.(audioLevel, botParticipant());
  }

  protected async handleTrackStarted(event: DailyEventObjectTrack) {
    if (!event.participant?.local) return;
    if (event.track.kind === "audio") {
      this._micEnabled = true;
      if (this._mediaStreamRecorder) {
        const status = this._mediaStreamRecorder.getStatus();
        switch (status) {
          case "ended":
            try {
              await this._mediaStreamRecorder.begin(event.track);
              this._startRecording();
            } catch (e) {
              // void. nothing to do.
            }
            break;
          case "paused":
            this._startRecording();
            break;
          case "recording":
          default:
            if (this._currentAudioTrack !== event.track) {
              await this._mediaStreamRecorder.end();
              try {
                await this._mediaStreamRecorder.begin(event.track);
                this._startRecording();
              } catch (e) {
                // void. nothing to do.
              }
            } else {
              console.warn(
                "track-started event received for current track and already recording"
              );
            }
            break;
        }
      }
      this._currentAudioTrack = event.track;
    } else if (event.track.kind === "video") {
      this._camEnabled = true;
    }
    this._callbacks.onTrackStarted?.(
      event.track,
      event.participant
        ? dailyParticipantToParticipant(event.participant)
        : undefined
    );
    if (isLocalTrackType(event.type)) {
      this._onTrackStarted?.(event.track, event.type);
    }
  }

  protected handleTrackStopped(event: DailyEventObjectTrack) {
    if (!event.participant?.local) return;
    // Tracks also stop when leave() tears the session down; by then the live
    // state has been reset to the connect-time flags, so leave it.
    if (event.track.kind === "audio") {
      if (this._initialized) this._micEnabled = false;
      if (
        this._mediaStreamRecorder &&
        this._mediaStreamRecorder.getStatus() === "recording"
      ) {
        this._mediaStreamRecorder.pause();
      }
    } else if (event.track.kind === "video") {
      if (this._initialized) this._camEnabled = false;
    }
    this._callbacks.onTrackStopped?.(
      event.track,
      event.participant
        ? dailyParticipantToParticipant(event.participant)
        : undefined
    );
    if (isLocalTrackType(event.type)) {
      this._onTrackStopped?.(event.track, event.type);
    }
  }
}

const dailyParticipantToParticipant = (p: DailyParticipant): Participant => ({
  id: p.user_id,
  local: p.local,
  name: p.user_name,
});

const botParticipant = () => ({
  id: "bot",
  local: false,
  name: "Bot",
});
