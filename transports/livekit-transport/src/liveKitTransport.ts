import {
  DeviceError,
  Participant,
  PipecatClientOptions,
  RTVIMessage,
  Tracks,
  Transport,
  TransportStartError,
  TransportState,
  logger,
} from "@pipecat-ai/client-js";
import {
  LocalParticipant,
  LocalTrackPublication,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomConnectOptions,
  RoomEvent,
  RoomOptions,
  Track,
} from "livekit-client";
import packageJson from "../package.json";

export type LiveKitConnectParams = {
  url: string;
  token: string;
  roomConnectionOptions?: RoomConnectOptions;
};

export type LiveKitTransportConstructorOptions = RoomOptions;

export class LiveKitTransport extends Transport {
  private _room: Room;

  private _selectedMic: MediaDeviceInfo | Record<string, never> = {};
  private _selectedCam: MediaDeviceInfo | Record<string, never> = {};
  private _selectedSpeaker: MediaDeviceInfo | Record<string, never> = {};

  private _micEnabled: boolean = false;
  private _camEnabled: boolean = false;
  private _listenersAttached: boolean = false;
  private _deviceChangeHandler = () => this.updateAvailableDevices();

  constructor(options: LiveKitTransportConstructorOptions = {}) {
    super();
    this._room = new Room(options);
  }

  public initialize(
    options: PipecatClientOptions,
    messageHandler: (ev: RTVIMessage) => void
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._onMessage = messageHandler;
    this._micEnabled = options.enableMic ?? true;
    this._camEnabled = options.enableCam ?? false;

    this.attachEventListeners();

    this.state = "disconnected";
    logger.debug("[LiveKit Transport] Initialized", packageJson.version);
  }

  get state(): TransportState {
    return this._state;
  }

  set state(state: TransportState) {
    if (this._state === state) return;

    this._state = state;
    this._callbacks.onTransportStateChanged?.(state);
  }

  async initDevices(): Promise<void> {
    this.state = "initializing";

    if (this._micEnabled || this._camEnabled) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: this._micEnabled,
          video: this._camEnabled,
        });

        await this.updateAvailableDevices();

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          const deviceId = audioTrack.getSettings().deviceId;
          const mics = await this.getAllMics();
          const mic = mics.find((m) => m.deviceId === deviceId);
          if (mic) {
            this._selectedMic = mic;
            this._callbacks.onMicUpdated?.(mic);
          }
          audioTrack.stop();
        }

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const deviceId = videoTrack.getSettings().deviceId;
          const cams = await this.getAllCams();
          const cam = cams.find((c) => c.deviceId === deviceId);
          if (cam) {
            this._selectedCam = cam;
            this._callbacks.onCamUpdated?.(cam);
          }
          videoTrack.stop();
        }
      } catch (e) {
        logger.warn("[LiveKit Transport] Could not initialize devices", e);
        await this.updateAvailableDevices();
      }
    } else {
      await this.updateAvailableDevices();
    }

    this.state = "initialized";
  }

  private async updateAvailableDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      const mics = devices.filter((d) => d.kind === "audioinput");
      const speakers = devices.filter((d) => d.kind === "audiooutput");

      this._callbacks.onAvailableCamsUpdated?.(cams);
      this._callbacks.onAvailableMicsUpdated?.(mics);
      this._callbacks.onAvailableSpeakersUpdated?.(speakers);
    } catch (e) {
      logger.error("Error enumerating devices", e);
    }
  }

  _validateConnectionParams(
    connectParams: unknown
  ): LiveKitConnectParams | undefined {
    if (!connectParams || typeof connectParams !== "object") return undefined;
    const p = connectParams as LiveKitConnectParams;
    if (!p.url || !p.token) {
      throw new Error("LiveKit connection requires 'url' and 'token'");
    }
    return p;
  }

  async _connect(connectParams?: LiveKitConnectParams): Promise<void> {
    if (!connectParams?.url || !connectParams?.token) {
      this.state = "error";
      throw new TransportStartError("LiveKit connection requires 'url' and 'token'");
    }

    this.state = "connecting";

    try {
      await this._room.connect(
        connectParams.url,
        connectParams.token,
        connectParams.roomConnectionOptions
      );
    } catch (e) {
      logger.error("Failed to connect to LiveKit room", e);
      this.state = "error";
      throw new TransportStartError();
    }

    await this._room.localParticipant.setMicrophoneEnabled(this._micEnabled);
    await this._room.localParticipant.setCameraEnabled(this._camEnabled);

    this.state = "connected";
    this._callbacks.onConnected?.();
  }

  async _disconnect(): Promise<void> {
    this.state = "disconnecting";
    navigator.mediaDevices.removeEventListener(
      "devicechange",
      this._deviceChangeHandler
    );
    await this._room.disconnect();
    this.state = "disconnected";
    this._callbacks.onDisconnected?.();
  }

  sendMessage(message: RTVIMessage): void {
    const str = JSON.stringify(message);
    const encoder = new TextEncoder();
    const data = encoder.encode(str);

    this._room.localParticipant.publishData(data, { reliable: true });
  }

  // Device Management
  async getAllMics(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
  }

  async getAllCams(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  async getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audiooutput");
  }

  async updateMic(micId: string): Promise<void> {
    if ((this._selectedMic as MediaDeviceInfo).deviceId === micId) return;
    try {
      await this._room.switchActiveDevice("audioinput", micId);
      const mics = await this.getAllMics();
      const mic = mics.find((m) => m.deviceId === micId);
      if (mic) {
        this._selectedMic = mic;
        this._callbacks.onMicUpdated?.(mic);
      }
    } catch (e: unknown) {
      this._callbacks.onDeviceError?.(
        new DeviceError(["mic"], "unknown", (e as Error).message)
      );
    }
  }

  async updateCam(camId: string): Promise<void> {
    if ((this._selectedCam as MediaDeviceInfo).deviceId === camId) return;
    try {
      await this._room.switchActiveDevice("videoinput", camId);
      const cams = await this.getAllCams();
      const cam = cams.find((c) => c.deviceId === camId);
      if (cam) {
        this._selectedCam = cam;
        this._callbacks.onCamUpdated?.(cam);
      }
    } catch (e: unknown) {
      this._callbacks.onDeviceError?.(
        new DeviceError(["cam"], "unknown", (e as Error).message)
      );
    }
  }

  async updateSpeaker(speakerId: string): Promise<void> {
    if ((this._selectedSpeaker as MediaDeviceInfo).deviceId === speakerId)
      return;
    try {
      await this._room.switchActiveDevice("audiooutput", speakerId);
      const speakers = await this.getAllSpeakers();
      const s = speakers.find((d) => d.deviceId === speakerId);
      if (s) {
        this._selectedSpeaker = s;
        this._callbacks.onSpeakerUpdated?.(s);
      }
    } catch (e: unknown) {
      this._callbacks.onDeviceError?.(
        new DeviceError(["speaker"], "unknown", (e as Error).message)
      );
    }
  }

  get selectedMic() {
    return this._selectedMic;
  }
  get selectedCam() {
    return this._selectedCam;
  }
  get selectedSpeaker() {
    return this._selectedSpeaker;
  }

  enableMic(enable: boolean): void {
    this._room.localParticipant
      .setMicrophoneEnabled(enable)
      .then(async () => {
        this._micEnabled = enable;
        if (enable) {
          const trackPub = this._room.localParticipant.getTrackPublication(
            Track.Source.Microphone
          );
          const deviceId =
            trackPub?.track?.mediaStreamTrack?.getSettings().deviceId;
          if (deviceId) {
            const mics = await this.getAllMics();
            const mic = mics.find((m) => m.deviceId === deviceId);
            if (
              mic &&
              (this._selectedMic as MediaDeviceInfo).deviceId !== mic.deviceId
            ) {
              this._selectedMic = mic;
              this._callbacks.onMicUpdated?.(mic);
            }
          }
        }
      })
      .catch((e) => {
        logger.error("Failed to toggle mic", e);
        this._callbacks.onDeviceError?.(
          new DeviceError(["mic"], "unknown", e.message)
        );
      });
  }

  enableCam(enable: boolean): void {
    this._room.localParticipant
      .setCameraEnabled(enable)
      .then(async () => {
        this._camEnabled = enable;
        if (enable) {
          const trackPub = this._room.localParticipant.getTrackPublication(
            Track.Source.Camera
          );
          const deviceId =
            trackPub?.track?.mediaStreamTrack?.getSettings().deviceId;
          if (deviceId) {
            const cams = await this.getAllCams();
            const cam = cams.find((c) => c.deviceId === deviceId);
            if (
              cam &&
              (this._selectedCam as MediaDeviceInfo).deviceId !== cam.deviceId
            ) {
              this._selectedCam = cam;
              this._callbacks.onCamUpdated?.(cam);
            }
          }
        }
      })
      .catch((e) => {
        logger.error("Failed to toggle cam", e);
        this._callbacks.onDeviceError?.(
          new DeviceError(["cam"], "unknown", e.message)
        );
      });
  }

  get isMicEnabled(): boolean {
    return this._micEnabled;
  }

  get isCamEnabled(): boolean {
    return this._camEnabled;
  }

  get isSharingScreen(): boolean {
    return this._room.localParticipant.isScreenShareEnabled;
  }

  enableScreenShare(enable: boolean): void {
    this._room.localParticipant.setScreenShareEnabled(enable);
  }

  tracks(): Tracks {
    const local = this._room.localParticipant;
    const getTrack = (
      p: LocalParticipant | RemoteParticipant,
      _kind: string,
      source: Track.Source
    ) => {
      const pub = p.getTrackPublication(source);
      return pub?.track?.mediaStreamTrack;
    };

    const localTracks = {
      audio: getTrack(local, "audio", Track.Source.Microphone),
      video: getTrack(local, "video", Track.Source.Camera),
      screenVideo: getTrack(local, "video", Track.Source.ScreenShare),
      screenAudio: getTrack(local, "audio", Track.Source.ScreenShareAudio),
    };

    const remoteParticipants = Array.from(
      this._room.remoteParticipants.values()
    );
    const botParticipant = remoteParticipants[0];
    const botTracks = botParticipant
      ? {
          audio: getTrack(botParticipant, "audio", Track.Source.Microphone),
          video: getTrack(botParticipant, "video", Track.Source.Camera),
        }
      : {};

    return { local: localTracks, bot: botTracks };
  }

  async sendReadyMessage() {
    this.state = "ready";
    await this._room.localParticipant.waitUntilActive();
    this.sendMessage(RTVIMessage.clientReady());
  }

  private attachEventListeners() {
    if (this._listenersAttached) return;
    this._listenersAttached = true;

    this._room
      .on(RoomEvent.DataReceived, this.handleDataReceived.bind(this))
      .on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed.bind(this))
      .on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed.bind(this))
      .on(
        RoomEvent.ParticipantConnected,
        this.handleParticipantConnected.bind(this)
      )
      .on(
        RoomEvent.ParticipantDisconnected,
        this.handleParticipantDisconnected.bind(this)
      )
      .on(RoomEvent.Disconnected, this.handleRoomDisconnected.bind(this))
      .on(
        RoomEvent.LocalTrackPublished,
        this.handleLocalTrackPublished.bind(this)
      )
      .on(
        RoomEvent.LocalTrackUnpublished,
        this.handleLocalTrackUnpublished.bind(this)
      )
      .on(RoomEvent.MediaDevicesError, this.handleMediaDevicesError.bind(this));

    navigator.mediaDevices.addEventListener(
      "devicechange",
      this._deviceChangeHandler
    );
  }

  private handleDataReceived(payload: Uint8Array) {
    try {
      const decoder = new TextDecoder();
      const str = decoder.decode(payload);
      const msg = JSON.parse(str);
      if (msg && typeof msg === "object" && "type" in msg) {
        this._onMessage(msg as RTVIMessage);
      }
    } catch (e) {
      logger.warn("Failed to parse data message", e);
    }
  }

  private handleTrackSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) {
    this._callbacks.onTrackStarted?.(
      track.mediaStreamTrack,
      this.toParticipant(participant)
    );
  }

  private handleTrackUnsubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) {
    if (track.mediaStreamTrack) {
      this._callbacks.onTrackStopped?.(
        track.mediaStreamTrack,
        this.toParticipant(participant)
      );
    }
  }

  private handleLocalTrackPublished(
    publication: LocalTrackPublication,
    participant: LocalParticipant
  ) {
    if (publication.track?.mediaStreamTrack) {
      this._callbacks.onTrackStarted?.(
        publication.track.mediaStreamTrack,
        this.toParticipant(participant)
      );
    }
    if (publication.source === Track.Source.Microphone) {
      const deviceId =
        publication.track?.mediaStreamTrack?.getSettings().deviceId;
      if (deviceId) {
        this.getAllMics().then((mics) => {
          const mic = mics.find((m) => m.deviceId === deviceId);
          if (mic) {
            this._selectedMic = mic;
            this._callbacks.onMicUpdated?.(mic);
          }
        });
      }
    }
  }

  private handleLocalTrackUnpublished(
    publication: LocalTrackPublication,
    participant: LocalParticipant
  ) {
    if (publication.track?.mediaStreamTrack) {
      this._callbacks.onTrackStopped?.(
        publication.track.mediaStreamTrack,
        this.toParticipant(participant)
      );
    }
  }

  private handleParticipantConnected(participant: RemoteParticipant) {
    this._callbacks.onParticipantJoined?.(this.toParticipant(participant));
  }

  private handleParticipantDisconnected(participant: RemoteParticipant) {
    this._callbacks.onParticipantLeft?.(this.toParticipant(participant));
  }

  private handleRoomDisconnected() {
    if (this.state !== "disconnected") {
      this.state = "disconnected";
      this._callbacks.onDisconnected?.();
    }
  }

  private handleMediaDevicesError(e: Error) {
    this._callbacks.onDeviceError?.(
      new DeviceError(["cam", "mic"], "unknown", e.message)
    );
  }

  private toParticipant(p: LocalParticipant | RemoteParticipant): Participant {
    return {
      id: p.identity,
      name: p.name || "",
      local: p instanceof LocalParticipant,
    };
  }
}
