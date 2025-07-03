import Daily, {
  DailyCall,
  DailyCallOptions,
  DailyEventObjectAppMessage,
  DailyEventObjectAvailableDevicesUpdated,
  DailyEventObjectFatalError,
  DailyEventObjectLocalAudioLevel,
  DailyEventObjectNonFatalError,
  DailyEventObjectParticipant,
  DailyEventObjectParticipantLeft,
  DailyEventObjectRemoteParticipantsAudioLevel,
  DailyEventObjectSelectedDevicesUpdated,
  DailyEventObjectTrack,
  DailyFactoryOptions,
  DailyParticipant,
} from "@daily-co/daily-js";
import {
  Participant,
  PipecatClientOptions,
  RTVIError,
  RTVIEventCallbacks,
  RTVIMessage,
  Tracks,
  Transport,
  TransportStartError,
  TransportState,
  logger,
} from "@pipecat-ai/client-js";

import { MediaStreamRecorder } from "../../../lib/wavtools";

import packageJson from "../package.json";

export interface DailyConnectionEndpoint {
  endpoint: string;
  headers?: Headers;
  requestData?: object;
  timeout?: number;
}

export interface DailyTransportConstructorOptions extends DailyFactoryOptions {
  bufferLocalAudioUntilBotReady?: boolean;
}

export enum DailyRTVIMessageType {
  AUDIO_BUFFERING_STARTED = "audio-buffering-started",
  AUDIO_BUFFERING_STOPPED = "audio-buffering-stopped",
}

class DailyCallWrapper {
  private _daily: DailyCall;
  private _proxy: DailyCall;

  constructor(daily: DailyCall) {
    this._daily = daily;
    this._proxy = new Proxy(this._daily, {
      get: (target, prop, receiver) => {
        if (typeof target[prop as keyof DailyCall] === "function") {
          let errMsg;
          switch (String(prop)) {
            // Disable methods that modify the lifecycle of the call. These operations
            // should be performed via the PipecatClient in order to keep state in sync.
            case "preAuth":
              errMsg = `Calls to preAuth() are disabled. Please use Transport.preAuth()`;
              break;
            case "startCamera":
              errMsg = `Calls to startCamera() are disabled. Please use PipecatClient.initDevices()`;
              break;
            case "join":
              errMsg = `Calls to join() are disabled. Please use PipecatClient.connect()`;
              break;
            case "leave":
              errMsg = `Calls to leave() are disabled. Please use PipecatClient.disconnect()`;
              break;
            case "destroy":
              errMsg = `Calls to destroy() are disabled.`;
              break;
          }
          if (errMsg) {
            return () => {
              throw new Error(errMsg);
            };
          }
          // Forward other method calls
          return (...args: any[]) => {
            return (target[prop as keyof DailyCall] as Function)(...args);
          };
        }
        // Forward property access
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  get proxy(): DailyCall {
    return this._proxy;
  }
}

export class DailyTransport extends Transport {
  declare private _dailyWrapper: DailyCallWrapper;
  declare private _daily: DailyCall;
  private _dailyFactoryOptions: DailyFactoryOptions;

  private _bufferLocalAudioUntilBotReady: boolean;
  private _botId: string = "";
  private _selectedCam: MediaDeviceInfo | Record<string, never> = {};
  private _selectedMic: MediaDeviceInfo | Record<string, never> = {};
  private _selectedSpeaker: MediaDeviceInfo | Record<string, never> = {};

  private static RECORDER_SAMPLE_RATE = 16_000;
  private static RECORDER_CHUNK_SIZE = 512;
  private _currentAudioTrack: MediaStreamTrack | null = null;
  private _audioQueue: ArrayBuffer[] = [];
  declare private _mediaStreamRecorder: MediaStreamRecorder;

  constructor(opts: DailyTransportConstructorOptions = {}) {
    super();

    this._callbacks = {} as RTVIEventCallbacks;

    const { bufferLocalAudioUntilBotReady, ...dailyOpts } = opts;
    this._dailyFactoryOptions = dailyOpts;
    this._bufferLocalAudioUntilBotReady =
      bufferLocalAudioUntilBotReady || false;

    this._daily = Daily.createCallObject({
      ...this._dailyFactoryOptions,
      allowMultipleCallInstances: true,
    });
    this._dailyWrapper = new DailyCallWrapper(this._daily);
  }

  private setupRecorder(): void {
    this._mediaStreamRecorder = new MediaStreamRecorder({
      sampleRate: DailyTransport.RECORDER_SAMPLE_RATE,
    });
  }

  handleUserAudioStream(data: ArrayBuffer): void {
    this._audioQueue.push(data);
  }

  private flushAudioQueue(): void {
    const batchSize = 10; // Number of buffers to send in one message
    if (this._audioQueue.length === 0) {
      return;
    }

    logger.debug(`Will flush audio queue: ${this._audioQueue.length}`);

    while (this._audioQueue.length > 0) {
      const batch: ArrayBuffer[] = [];

      // Collect up to `batchSize` items
      while (batch.length < batchSize && this._audioQueue.length > 0) {
        const queuedData = this._audioQueue.shift();
        if (queuedData) batch.push(queuedData);
      }

      if (batch.length > 0) {
        this._sendAudioBatch(batch);
      }
    }
  }

  _sendAudioBatch(dataBatch: ArrayBuffer[]): void {
    const encodedBatch = dataBatch.map((data) => {
      const pcmByteArray = new Uint8Array(data);
      return btoa(String.fromCharCode(...pcmByteArray));
    });

    const audioMessage: RTVIMessage = {
      id: "raw-audio-batch",
      label: "rtvi-ai",
      type: "raw-audio-batch",
      data: {
        base64AudioBatch: encodedBatch, // Sending an array of base64 strings
        sampleRate: DailyTransport.RECORDER_SAMPLE_RATE,
        numChannels: 1,
      },
    };

    this.sendMessage(audioMessage);
  }

  public initialize(
    options: PipecatClientOptions,
    messageHandler: (ev: RTVIMessage) => void,
  ): void {
    if (this._bufferLocalAudioUntilBotReady) {
      this.setupRecorder();
    }

    this._callbacks = options.callbacks ?? {};
    this._onMessage = messageHandler;

    if (
      this._dailyFactoryOptions.startVideoOff == null ||
      options.enableCam != null
    ) {
      // Default is cam off
      this._dailyFactoryOptions.startVideoOff = !(options.enableCam ?? false);
    }
    if (
      this._dailyFactoryOptions.startAudioOff == null ||
      options.enableMic != null
    ) {
      // Default is mic on
      this._dailyFactoryOptions.startAudioOff = !(options.enableMic ?? true);
    }

    this.attachEventListeners();

    this.state = "disconnected";

    logger.debug("[Daily Transport] Initialized", packageJson.version);
  }

  get dailyCallClient(): DailyCall {
    return this._dailyWrapper.proxy;
  }

  get state(): TransportState {
    return this._state;
  }

  private set state(state: TransportState) {
    if (this._state === state) return;

    this._state = state;
    this._callbacks.onTransportStateChanged?.(state);
  }

  async getAllCams() {
    const { devices } = await this._daily.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  updateCam(camId: string) {
    this._daily
      .setInputDevicesAsync({
        videoDeviceId: camId,
      })
      .then((infos) => {
        this._selectedCam = infos.camera;
      });
  }

  get selectedCam() {
    return this._selectedCam;
  }

  async getAllMics() {
    const { devices } = await this._daily.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
  }

  updateMic(micId: string) {
    this._daily
      .setInputDevicesAsync({
        audioDeviceId: micId,
      })
      .then((infos) => {
        this._selectedMic = infos.mic;
      });
  }

  get selectedMic() {
    return this._selectedMic;
  }

  async getAllSpeakers() {
    const { devices } = await this._daily.enumerateDevices();
    return devices.filter((d) => d.kind === "audiooutput");
  }

  updateSpeaker(speakerId: string) {
    this._daily
      .setOutputDeviceAsync({ outputDeviceId: speakerId })
      .then((infos) => {
        this._selectedSpeaker = infos.speaker;
      });
  }

  get selectedSpeaker() {
    return this._selectedSpeaker;
  }

  enableMic(enable: boolean) {
    this._daily.setLocalAudio(enable);
  }

  get isMicEnabled() {
    return this._daily.localAudio();
  }

  enableCam(enable: boolean) {
    this._daily.setLocalVideo(enable);
  }

  get isCamEnabled() {
    return this._daily.localVideo();
  }

  public enableScreenShare(enable: boolean) {
    if (enable) {
      this._daily.startScreenShare();
    } else {
      this._daily.stopScreenShare();
    }
  }

  public get isSharingScreen(): boolean {
    return this._daily.localScreenAudio() || this._daily.localScreenVideo();
  }

  tracks() {
    const participants = this._daily.participants() ?? {};
    const bot = participants?.[this._botId];

    const tracks: Tracks = {
      local: {
        audio: participants?.local?.tracks?.audio?.persistentTrack,
        screenAudio: participants?.local?.tracks?.screenAudio?.persistentTrack,
        screenVideo: participants?.local?.tracks?.screenVideo?.persistentTrack,
        video: participants?.local?.tracks?.video?.persistentTrack,
      },
    };

    if (bot) {
      tracks.bot = {
        audio: bot?.tracks?.audio?.persistentTrack,
        video: bot?.tracks?.video?.persistentTrack,
      };
    }

    return tracks;
  }

  private async startRecording(): Promise<void> {
    try {
      logger.info("[Daily Transport] Initializing recording");
      await this._mediaStreamRecorder.record((data) => {
        this.handleUserAudioStream(data.mono);
      }, DailyTransport.RECORDER_CHUNK_SIZE);
      this._onMessage({
        type: DailyRTVIMessageType.AUDIO_BUFFERING_STARTED,
        data: {},
      } as RTVIMessage);
      logger.info("[Daily Transport] Recording Initialized");
    } catch (e) {
      const err = e as Error;
      if (!err.message.includes("Already recording")) {
        logger.error("Error starting recording", e);
      }
    }
  }

  async preAuth(dailyCallOptions: DailyCallOptions) {
    this._dailyFactoryOptions = dailyCallOptions;
    await this._daily.preAuth(dailyCallOptions);
  }

  async initDevices() {
    if (!this._daily) {
      throw new RTVIError("Transport instance not initialized");
    }

    this.state = "initializing";

    const infos = await this._daily.startCamera(this._dailyFactoryOptions);
    const { devices } = await this._daily.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");
    const mics = devices.filter((d) => d.kind === "audioinput");
    const speakers = devices.filter((d) => d.kind === "audiooutput");
    this._selectedCam = infos.camera;
    this._selectedMic = infos.mic;
    this._selectedSpeaker = infos.speaker;

    this._callbacks.onAvailableCamsUpdated?.(cams);
    this._callbacks.onAvailableMicsUpdated?.(mics);
    this._callbacks.onAvailableSpeakersUpdated?.(speakers);
    this._callbacks.onCamUpdated?.(infos.camera as MediaDeviceInfo);
    this._callbacks.onMicUpdated?.(infos.mic as MediaDeviceInfo);
    this._callbacks.onSpeakerUpdated?.(infos.speaker as MediaDeviceInfo);

    // Instantiate audio observers
    if (!this._daily.isLocalAudioLevelObserverRunning())
      await this._daily.startLocalAudioLevelObserver(100);
    if (!this._daily.isRemoteParticipantsAudioLevelObserverRunning())
      await this._daily.startRemoteParticipantsAudioLevelObserver(100);

    this.state = "initialized";
  }

  _validateConnectionParams(
    connectParams?: unknown,
  ): DailyCallOptions | undefined {
    if (connectParams === undefined || connectParams === null) {
      return undefined;
    }
    if (typeof connectParams !== "object") {
      throw new RTVIError("Invalid connection parameters");
    }
    type DailyConnectParams = DailyCallOptions & {
      room_url?: string;
    };
    const tmpParams = connectParams as DailyConnectParams;
    if (tmpParams.room_url) {
      tmpParams.url = tmpParams.room_url;
      delete tmpParams.room_url;
    }
    if (!tmpParams.token) {
      // Daily doesn't like token being in the map and undefined or null
      delete tmpParams.token;
    }
    return tmpParams as DailyCallOptions;
  }

  async _connect(connectParams?: DailyCallOptions) {
    if (!this._daily) {
      throw new RTVIError("Transport instance not initialized");
    }

    if (connectParams) {
      this._dailyFactoryOptions = {
        ...this._dailyFactoryOptions,
        ...connectParams,
      };
    }

    this.state = "connecting";

    try {
      await this._daily.join(this._dailyFactoryOptions);
    } catch (e) {
      logger.error("Failed to join room", e);
      this.state = "error";
      throw new TransportStartError();
    }

    if (this._abortController?.signal.aborted) return;

    this.state = "connected";

    this._callbacks.onConnected?.();
  }

  async sendReadyMessage(): Promise<void> {
    return new Promise<void>((resolve) => {
      // Detect iOS devices
      const isIOS = (): boolean => {
        const userAgent = navigator.userAgent;
        return (
          /iPad|iPhone|iPod/.test(userAgent) ||
          (/Macintosh/.test(userAgent) && "ontouchend" in document)
        );
      };

      const sendReadyMessage = () => {
        this.state = "ready";
        this.flushAudioQueue();
        this.sendMessage(RTVIMessage.clientReady());
        this.stopRecording();
        resolve();
      };

      for (const id in this._daily.participants()) {
        const p = this._daily.participants()[id];
        if (!p.local && p.tracks?.audio?.persistentTrack) {
          // If we already have a remote audio track, we can send the ready message immediately
          sendReadyMessage();
          resolve();
          return;
        }
      }

      const readyHandler = (ev: DailyEventObjectTrack) => {
        if (!ev.participant?.local) {
          this._daily.off("track-started", readyHandler);

          // Check if it's an iOS device
          if (isIOS()) {
            logger.debug(
              "[Daily Transport] iOS device detected, adding 0.5 second delay before sending ready message",
            );

            // Add 500ms delay for iOS devices:
            // This is a workaround for iOS devices clipping a portion
            // of the audio after the track becomes playable.
            setTimeout(sendReadyMessage, 500);
          } else {
            // Non-iOS device, send ready message immediately
            sendReadyMessage();
          }
        }
      };

      this._daily.on("track-started", readyHandler);
    });
  }

  private stopRecording() {
    if (
      this._mediaStreamRecorder &&
      this._mediaStreamRecorder.getStatus() !== "ended"
    ) {
      // disconnecting, we don't need to record anymore
      void this._mediaStreamRecorder.end();
      this._onMessage({
        type: DailyRTVIMessageType.AUDIO_BUFFERING_STOPPED,
        data: {},
      } as RTVIMessage);
    }
  }

  private attachEventListeners() {
    this._daily.on(
      "available-devices-updated",
      this.handleAvailableDevicesUpdated.bind(this),
    );
    this._daily.on(
      "selected-devices-updated",
      this.handleSelectedDevicesUpdated.bind(this),
    );

    this._daily.on("track-started", this.handleTrackStarted.bind(this));
    this._daily.on("track-stopped", this.handleTrackStopped.bind(this));
    this._daily.on(
      "participant-joined",
      this.handleParticipantJoined.bind(this),
    );
    this._daily.on("participant-left", this.handleParticipantLeft.bind(this));
    this._daily.on("local-audio-level", this.handleLocalAudioLevel.bind(this));
    this._daily.on(
      "remote-participants-audio-level",
      this.handleRemoteAudioLevel.bind(this),
    );
    this._daily.on("app-message", this.handleAppMessage.bind(this));
    this._daily.on("left-meeting", this.handleLeftMeeting.bind(this));
    this._daily.on("error", this.handleFatalError.bind(this));
    this._daily.on("nonfatal-error", this.handleNonFatalError.bind(this));
  }

  async _disconnect() {
    this.state = "disconnecting";
    this._daily.stopLocalAudioLevelObserver();
    this._daily.stopRemoteParticipantsAudioLevelObserver();

    this._audioQueue = [];
    this._currentAudioTrack = null;
    this.stopRecording();

    await this._daily.leave();
  }

  public sendMessage(message: RTVIMessage) {
    this._daily.sendAppMessage(message, "*");
  }

  private handleAppMessage(ev: DailyEventObjectAppMessage) {
    // Bubble any messages with rtvi-ai label
    if (ev.data.label === "rtvi-ai") {
      this._onMessage({
        id: ev.data.id,
        type: ev.data.type,
        data: ev.data.data,
      } as RTVIMessage);
    }
  }

  private handleAvailableDevicesUpdated(
    ev: DailyEventObjectAvailableDevicesUpdated,
  ) {
    this._callbacks.onAvailableCamsUpdated?.(
      ev.availableDevices.filter((d) => d.kind === "videoinput"),
    );
    this._callbacks.onAvailableMicsUpdated?.(
      ev.availableDevices.filter((d) => d.kind === "audioinput"),
    );
    this._callbacks.onAvailableSpeakersUpdated?.(
      ev.availableDevices.filter((d) => d.kind === "audiooutput"),
    );
  }

  private handleSelectedDevicesUpdated(
    ev: DailyEventObjectSelectedDevicesUpdated,
  ) {
    if (this._selectedCam?.deviceId !== ev.devices.camera) {
      this._selectedCam = ev.devices.camera;
      this._callbacks.onCamUpdated?.(ev.devices.camera as MediaDeviceInfo);
    }
    if (this._selectedMic?.deviceId !== ev.devices.mic) {
      this._selectedMic = ev.devices.mic;
      this._callbacks.onMicUpdated?.(ev.devices.mic as MediaDeviceInfo);
    }
    if (this._selectedSpeaker?.deviceId !== ev.devices.speaker) {
      this._selectedSpeaker = ev.devices.speaker;
      this._callbacks.onSpeakerUpdated?.(ev.devices.speaker as MediaDeviceInfo);
    }
  }

  private async handleLocalAudioTrack(track: MediaStreamTrack) {
    if (this.state == "ready" || !this._bufferLocalAudioUntilBotReady) {
      return;
    }
    const status = this._mediaStreamRecorder.getStatus();
    switch (status) {
      case "ended":
        await this._mediaStreamRecorder.begin(track);
        await this.startRecording();
        break;
      case "paused":
        await this.startRecording();
        break;
      case "recording":
      default:
        if (this._currentAudioTrack !== track) {
          await this._mediaStreamRecorder.end();
          await this._mediaStreamRecorder.begin(track);
          await this.startRecording();
        } else {
          logger.warn(
            "track-started event received for current track and already recording",
          );
        }
        break;
    }
    this._currentAudioTrack = track;
  }

  private handleTrackStarted(ev: DailyEventObjectTrack) {
    if (ev.type === "screenAudio" || ev.type === "screenVideo") {
      this._callbacks.onScreenTrackStarted?.(
        ev.track,
        ev.participant
          ? dailyParticipantToParticipant(ev.participant)
          : undefined,
      );
    } else {
      if (ev.participant?.local && ev.track.kind === "audio") {
        void this.handleLocalAudioTrack(ev.track);
      }
      this._callbacks.onTrackStarted?.(
        ev.track,
        ev.participant
          ? dailyParticipantToParticipant(ev.participant)
          : undefined,
      );
    }
  }

  private handleTrackStopped(ev: DailyEventObjectTrack) {
    if (ev.type === "screenAudio" || ev.type === "screenVideo") {
      this._callbacks.onScreenTrackStopped?.(
        ev.track,
        ev.participant
          ? dailyParticipantToParticipant(ev.participant)
          : undefined,
      );
    } else {
      this._callbacks.onTrackStopped?.(
        ev.track,
        ev.participant
          ? dailyParticipantToParticipant(ev.participant)
          : undefined,
      );
    }
  }

  private handleParticipantJoined(ev: DailyEventObjectParticipant) {
    const p = dailyParticipantToParticipant(ev.participant);

    this._callbacks.onParticipantJoined?.(p);

    if (p.local) return;

    this._botId = ev.participant.session_id;

    this._callbacks.onBotConnected?.(p);
  }

  private handleParticipantLeft(ev: DailyEventObjectParticipantLeft) {
    const p = dailyParticipantToParticipant(ev.participant);

    this._callbacks.onParticipantLeft?.(p);

    if (p.local) return;

    this._botId = "";

    this._callbacks.onBotDisconnected?.(p);
  }

  private handleLocalAudioLevel(ev: DailyEventObjectLocalAudioLevel) {
    this._callbacks.onLocalAudioLevel?.(ev.audioLevel);
  }

  private handleRemoteAudioLevel(
    ev: DailyEventObjectRemoteParticipantsAudioLevel,
  ) {
    const participants = this._daily.participants();
    const ids = Object.keys(ev.participantsAudioLevel);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const level = ev.participantsAudioLevel[id];
      this._callbacks.onRemoteAudioLevel?.(
        level,
        dailyParticipantToParticipant(participants[id]),
      );
    }
  }

  private handleLeftMeeting() {
    this.state = "disconnected";
    this._botId = "";
    this._callbacks.onDisconnected?.();
  }

  private handleFatalError(ev: DailyEventObjectFatalError) {
    logger.error("Daily fatal error", ev.errorMsg);
    this.state = "error";
    this._botId = "";
    this._callbacks.onError?.(RTVIMessage.error(ev.errorMsg, true));
  }

  private handleNonFatalError(ev: DailyEventObjectNonFatalError) {
    switch (ev.type) {
      case "screen-share-error":
        this._callbacks.onScreenShareError?.(ev.errorMsg);
        break;
    }
  }
}

const dailyParticipantToParticipant = (p: DailyParticipant): Participant => ({
  id: p.user_id,
  local: p.local,
  name: p.user_name,
});
