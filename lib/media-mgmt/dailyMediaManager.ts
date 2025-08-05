import { MediaManager } from "./mediaManager";
import { MediaStreamRecorder, WavStreamPlayer } from "../wavtools";

import Daily, {
  DailyCall,
  DailyEventObjectAvailableDevicesUpdated,
  DailyEventObjectLocalAudioLevel,
  DailyEventObjectSelectedDevicesUpdated,
  DailyEventObjectTrack,
  DailyParticipant,
  DailyParticipantsObject,
} from "@daily-co/daily-js";
import { Participant, Tracks } from "@pipecat-ai/client-js";

export class DailyMediaManager extends MediaManager {
  private _daily: DailyCall;
  private _mediaStreamRecorder: MediaStreamRecorder | undefined;
  private _wavStreamPlayer: WavStreamPlayer | undefined;

  private _initialized: boolean;
  private _connected: boolean;
  private _connectResolve: ((value: void | PromiseLike<void>) => void) | null;

  private _currentAudioTrack: MediaStreamTrack | null;
  private _selectedCam: MediaDeviceInfo | Record<string, never> = {};
  private _selectedMic: MediaDeviceInfo | Record<string, never> = {};
  private _selectedSpeaker: MediaDeviceInfo | Record<string, never> = {};

  private _remoteAudioLevelInterval: NodeJS.Timeout | null = null;

  private onTrackStartedCallback?: (event: DailyEventObjectTrack) => void;
  private onTrackStoppedCallback?: (event: DailyEventObjectTrack) => void;

  private _recorderChunkSize: number | undefined = undefined;

  constructor(
    enablePlayer: boolean = true,
    enableRecording: boolean = true,
    onTrackStartedCallback?: (event: DailyEventObjectTrack) => void,
    onTrackStoppedCallback?: (event: DailyEventObjectTrack) => void,
    recorderChunkSize: number | undefined = undefined,
    recorderSampleRate: number = 24000,
    playerSampleRate: number = 24000,
  ) {
    super();
    this._initialized = false;
    this._connected = false;
    this._currentAudioTrack = null;
    this._connectResolve = null;
    this.onTrackStartedCallback = onTrackStartedCallback;
    this.onTrackStoppedCallback = onTrackStoppedCallback;
    this._recorderChunkSize = recorderChunkSize;

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
      this._handleAvailableDevicesUpdated.bind(this),
    );
    this._daily.on(
      "selected-devices-updated",
      this._handleSelectedDevicesUpdated.bind(this),
    );
    this._daily.on("local-audio-level", this._handleLocalAudioLevel.bind(this));
  }

  async initialize(): Promise<void> {
    if (this._initialized) {
      console.warn("DailyMediaManager already initialized");
      return;
    }
    const infos = await this._daily.startCamera({
      startVideoOff: !this._camEnabled,
      startAudioOff: !this._micEnabled,
    });
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
    this._initialized = true;
  }

  async connect(): Promise<void> {
    if (this._connected) {
      console.warn("DailyMediaManager already connected");
      return;
    }
    this._connected = true;
    if (!this._initialized) {
      return new Promise((resolve) => {
        (async () => {
          this._connectResolve = resolve;
          await this.initialize();
        })();
      });
    }
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
    await this._mediaStreamRecorder?.end();
    this._wavStreamPlayer?.interrupt();
    this._initialized = false;
    this._connected = false;
  }

  async userStartedSpeaking(): Promise<unknown> {
    return this._wavStreamPlayer?.interrupt();
  }

  bufferBotAudio(
    data: ArrayBuffer | Int16Array,
    id?: string,
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
        defaultSpeaker.label.includes(s.label),
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
    this._micEnabled = enable;
    if (!this._daily.participants()?.local) return;
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
    this._camEnabled = enable;
    this._daily.setLocalVideo(enable);
    
    // Apply video constraints to reduce data transmission when camera is enabled
    if (enable) {
      this.applyVideoConstraints();
    }
  }

  private applyVideoConstraints(): void {
    const participants = this._daily.participants();
    const videoTrack = participants?.local?.tracks?.video?.persistentTrack;
    if (videoTrack) {
      // Apply constraints to reduce bandwidth usage
      videoTrack.applyConstraints({
        width: { ideal: 640, max: 640 },
        height: { ideal: 360, max: 360 },
        frameRate: { ideal: 3, max:3 }
      }).catch(error => {
        console.warn("Failed to apply video constraints:", error);
      });
    }
  }

  get isCamEnabled(): boolean {
    return this._daily.localVideo();
  }
  get isMicEnabled(): boolean {
    return this._daily.localAudio();
  }

  tracks(): Tracks {
    const participants: DailyParticipantsObject = this._daily.participants();
    return {
      local: {
        audio: participants?.local?.tracks?.audio?.persistentTrack,
        video: participants?.local?.tracks?.video?.persistentTrack,
      },
    };
  }

  private _startRecording(): void {
    if (!this._connected || !this._mediaStreamRecorder) return;
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
    event: DailyEventObjectAvailableDevicesUpdated,
  ) {
    this._callbacks.onAvailableCamsUpdated?.(
      event.availableDevices.filter((d) => d.kind === "videoinput"),
    );
    this._callbacks.onAvailableMicsUpdated?.(
      event.availableDevices.filter((d) => d.kind === "audioinput"),
    );
    this._callbacks.onAvailableSpeakersUpdated?.(
      event.availableDevices.filter((d) => d.kind === "audiooutput"),
    );
    if (this._selectedSpeaker.deviceId === "default") {
      this.updateSpeaker("default");
    }
  }

  private _handleSelectedDevicesUpdated(
    event: DailyEventObjectSelectedDevicesUpdated,
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

  private _handleLocalAudioLevel(ev: DailyEventObjectLocalAudioLevel) {
    this._callbacks.onLocalAudioLevel?.(ev.audioLevel);
  }

  private _handleRemoteAudioLevel(audioLevel: number) {
    this._callbacks.onRemoteAudioLevel?.(audioLevel, botParticipant());
  }

  protected async handleTrackStarted(event: DailyEventObjectTrack) {
    if (!event.participant?.local) return;
    if (event.track.kind === "audio") {
      if (this._mediaStreamRecorder) {
        const status = this._mediaStreamRecorder.getStatus();
        switch (status) {
          case "ended":
            await this._mediaStreamRecorder.begin(event.track);
            if (this._connected) {
              this._startRecording();
              if (this._connectResolve) {
                this._connectResolve();
                this._connectResolve = null;
              }
            }
            break;
          case "paused":
            this._startRecording();
            break;
          case "recording":
          default:
            if (this._currentAudioTrack !== event.track) {
              await this._mediaStreamRecorder.end();
              await this._mediaStreamRecorder.begin(event.track);
              this._startRecording();
            } else {
              console.warn(
                "track-started event received for current track and already recording",
              );
            }
            break;
        }
      }
      this._currentAudioTrack = event.track;
    } else if (event.track.kind === "video") {
      // Apply video constraints to reduce data transmission
      try {
        await event.track.applyConstraints({
          width: { ideal: 640, max: 360 },
          height: { ideal: 640, max: 360 },
          frameRate: { ideal: 3, max: 3 }
        });
      } catch (error) {
        console.warn("Failed to apply video constraints:", error);
      }
    }
    this._callbacks.onTrackStarted?.(
      event.track,
      event.participant
        ? dailyParticipantToParticipant(event.participant)
        : undefined,
    );
    this.onTrackStartedCallback?.(event);
  }

  protected handleTrackStopped(event: DailyEventObjectTrack) {
    if (!event.participant?.local) return;
    if (event.track.kind === "audio") {
      if (
        this._mediaStreamRecorder &&
        this._mediaStreamRecorder.getStatus() === "recording"
      ) {
        this._mediaStreamRecorder.pause();
      }
    }
    this._callbacks.onTrackStopped?.(
      event.track,
      event.participant
        ? dailyParticipantToParticipant(event.participant)
        : undefined,
    );
    this.onTrackStoppedCallback?.(event);
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
