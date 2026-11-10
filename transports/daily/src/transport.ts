import Daily, {
  DailyCall,
  DailyCallOptions,
  DailyCameraErrorObject,
  DailyCameraErrorType,
  DailyEventObjectAppMessage,
  DailyEventObjectAvailableDevicesUpdated,
  DailyEventObjectCameraError,
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
  DailyRoomInfo,
} from "@daily-co/daily-js";
import {
  DeviceArray,
  DeviceError,
  MediaSupport,
  MessageTooLargeError,
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

import {
  browserSupportsScreenShare,
  MediaStreamRecorder,
} from "@pipecat-ai/transport-lib";

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

export type DailyEventCallbacks = RTVIEventCallbacks &
  Partial<{
    onAudioBufferingStarted: () => void;
    onAudioBufferingStopped: () => void;
  }>;

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
              errMsg = `Calls to startCamera() are disabled. Please use PipecatClient.enableMic() / enableCam() or PipecatClient.initDevices()`;
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
  // override type of _callbacks to include Daily specific callbacks
  declare protected _callbacks: DailyEventCallbacks;

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

  // NOTE: deliberately not read live off `this._daily.localAudio()` /
  // `localVideo()` in the isMicEnabled/isCamEnabled getters below. Daily
  // fires 'track-started'/'track-stopped' *before* it commits the new state
  // to the participant object those calls read from (daily-js emits the
  // track event from within its participant-updated handling, then
  // reassigns its internal participant cache afterwards). Code that reacts
  // to TrackStarted/TrackStopped by reading isMicEnabled/isCamEnabled to
  // resync UI state — e.g. PipecatClientState's mic/cam sync — would
  // otherwise always observe the pre-toggle value. These fields are updated
  // synchronously in enableMic/enableCam and in handleTrackStarted/
  // handleTrackStopped, before those callbacks fire.
  //
  // While media is running they are the truth of the session. While nothing
  // is running (before the first startCamera()/join(), and again after
  // _disconnect()) they hold the connect-time flags, i.e. what the next
  // connect() will do, so a fresh transport and a disconnected one read the
  // same way.
  private _micEnabled: boolean = true;
  private _camEnabled: boolean = false;

  // Whether daily-js has media running for this session: startCamera() or
  // join() has resolved and leave() has not run since. daily-js needs one of
  // those once per session before setLocalAudio() / setLocalVideo() do
  // anything, so enabling a device with nothing running starts the camera.
  private _cameraStarted = false;
  private _startCameraPromise: Promise<void> | null = null;

  constructor(opts: DailyTransportConstructorOptions = {}) {
    super();

    this._callbacks = {} as DailyEventCallbacks;

    const { bufferLocalAudioUntilBotReady, ...dailyOpts } = opts;
    this._dailyFactoryOptions = dailyOpts;
    // Enable device preference cookies by default
    if (
      typeof this._dailyFactoryOptions.dailyConfig
        ?.useDevicePreferenceCookies === "undefined"
    ) {
      // purposeful == to check undefined or null
      if (this._dailyFactoryOptions.dailyConfig == null) {
        this._dailyFactoryOptions.dailyConfig = {};
      }
      this._dailyFactoryOptions.dailyConfig.useDevicePreferenceCookies = true;
    }
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
    messageHandler: (ev: RTVIMessage) => void
  ): void {
    if (this._bufferLocalAudioUntilBotReady) {
      this.setupRecorder();
    }

    this._callbacks = (options.callbacks ?? {}) as DailyEventCallbacks;
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
    this._camEnabled = !this._dailyFactoryOptions.startVideoOff;
    this._micEnabled = !this._dailyFactoryOptions.startAudioOff;

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

  getSessionInfo() {
    return this._daily.meetingSessionSummary();
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
      })
      .catch((e) => {
        this._callbacks.onDeviceError?.(
          new DeviceError(["speaker"], e.type ?? "unknown", e.message)
        );
      });
  }

  get selectedSpeaker() {
    return this._selectedSpeaker;
  }

  // The connect-time flags are _dailyFactoryOptions.startAudioOff /
  // startVideoOff: the state the mic and cam should be in when a session
  // starts. Outside a session enableMic() / enableCam() update them, so the
  // next connect() lands on what the app last asked for. Once connect()
  // begins they are frozen for that session and the calls are live toggles
  // only, so a mid-session mute does not leak into the next connect().
  private get _inSession(): boolean {
    return ["connecting", "connected", "ready", "disconnecting"].includes(
      this.state
    );
  }

  enableMic(enable: boolean) {
    this._micEnabled = enable;
    if (!this._inSession) {
      this._dailyFactoryOptions.startAudioOff = !enable;
    }
    this._applyEnable("mic", enable);
  }

  get isMicEnabled() {
    return this._micEnabled;
  }

  enableCam(enable: boolean) {
    this._camEnabled = enable;
    if (!this._inSession) {
      this._dailyFactoryOptions.startVideoOff = !enable;
    }
    this._applyEnable("cam", enable);
  }

  // With media running this session, a toggle is a live setLocalAudio() /
  // setLocalVideo(). With nothing running, enabling acquires: startCamera()
  // with the connect-time flags. That is also what re-attempts a blocked
  // device, and daily-js re-fires camera-error if it is still blocked.
  // Disabling with nothing running only records the preference; it never
  // prompts for a device the app has turned off. While join() is in flight
  // there is nothing to apply to yet; _connect() applies the toggle once
  // join() resolves.
  private _applyEnable(kind: "mic" | "cam", enable: boolean) {
    if (this._cameraStarted) {
      if (kind === "mic") this._daily.setLocalAudio(enable);
      else this._daily.setLocalVideo(enable);
      return;
    }
    if (!enable || this._inSession) return;
    this._startCamera().catch((e) => {
      logger.error("[Daily Transport] Failed to start devices", e);
      this._callbacks.onDeviceError?.(
        new DeviceError(
          [kind],
          "unknown",
          e instanceof Error ? e.message : String(e)
        )
      );
    });
  }

  // The once-per-session startCamera() that must precede join() for live
  // toggles to work. Shared across concurrent callers (enableMic() followed
  // by enableCam() issues one call), and toggles that arrive while it is in
  // flight are applied once it resolves. Reports the resulting device
  // selection so the client learns what was acquired.
  private _startCamera(): Promise<void> {
    if (this._startCameraPromise) return this._startCameraPromise;
    this._startCameraPromise = (async () => {
      const requested = this._requestedState();
      try {
        const infos = await this._daily.startCamera(this._dailyFactoryOptions);
        this._cameraStarted = true;
        this._selectedCam = infos.camera;
        this._selectedMic = infos.mic;
        this._selectedSpeaker = infos.speaker;
        this._applyTogglesSince(requested);
        await this._reportDevices();
      } finally {
        this._startCameraPromise = null;
      }
    })();
    return this._startCameraPromise;
  }

  private _requestedState(): { mic: boolean; cam: boolean } {
    return { mic: this._micEnabled, cam: this._camEnabled };
  }

  // Toggles that arrived while startCamera() or join() was in flight had
  // nothing to apply to; apply them now that media is running.
  private _applyTogglesSince(requested: { mic: boolean; cam: boolean }) {
    if (this._micEnabled !== requested.mic) {
      this._daily.setLocalAudio(this._micEnabled);
    }
    if (this._camEnabled !== requested.cam) {
      this._daily.setLocalVideo(this._camEnabled);
    }
  }

  private async _reportDevices() {
    const { devices } = await this._daily.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");
    const mics = devices.filter((d) => d.kind === "audioinput");
    const speakers = devices.filter((d) => d.kind === "audiooutput");

    this._callbacks.onAvailableCamsUpdated?.(cams);
    this._callbacks.onAvailableMicsUpdated?.(mics);
    this._callbacks.onAvailableSpeakersUpdated?.(speakers);
    this._callbacks.onCamUpdated?.(this._selectedCam as MediaDeviceInfo);
    this._callbacks.onMicUpdated?.(this._selectedMic as MediaDeviceInfo);
    this._callbacks.onSpeakerUpdated?.(
      this._selectedSpeaker as MediaDeviceInfo
    );
  }

  get isCamEnabled() {
    return this._camEnabled;
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

  /** Carries every kind of media; screen share where the browser can. */
  get mediaSupport(): MediaSupport {
    return {
      mic: true,
      cam: true,
      screenShare: browserSupportsScreenShare(),
      botAudio: true,
      botVideo: true,
    };
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
      this._callbacks.onAudioBufferingStarted?.();
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

  // Start media for this session per the connect-time flags and report the
  // devices. Safe to call any number of times: with media already running it
  // only re-reports. Inside a session it leaves the transport state alone.
  async initDevices() {
    if (!this._daily) {
      throw new RTVIError("Transport instance not initialized");
    }

    // Media is session-scoped once join() runs: there is nothing for
    // initDevices() to set up, and enableMic() / enableCam() are the live
    // controls. PipecatClient.initDevices() already skips the call in a
    // session; this guards direct callers the same way.
    if (this._inSession) {
      logger.warn(
        `[Daily Transport] initDevices() ignored while ${this.state}. Use enableMic() / enableCam() during a session.`
      );
      return;
    }

    this.state = "initializing";

    if (this._cameraStarted) {
      await this._reportDevices();
    } else {
      await this._startCamera();
    }

    await this.startAudioLevelObservers();

    this.state = "initialized";
  }

  private async startAudioLevelObservers() {
    try {
      if (!this._daily.isLocalAudioLevelObserverRunning())
        await this._daily.startLocalAudioLevelObserver(100);
      if (!this._daily.isRemoteParticipantsAudioLevelObserverRunning())
        await this._daily.startRemoteParticipantsAudioLevelObserver(100);
    } catch (e) {
      logger.warn("[Daily Transport] Failed to start audio level observers", e);
    }
  }

  _validateConnectionParams(
    connectParams?: unknown
  ): DailyCallOptions | undefined {
    if (connectParams === undefined || connectParams === null) {
      return undefined;
    }
    if (typeof connectParams !== "object") {
      throw new RTVIError("Invalid connection parameters");
    }
    type DailyConnectParams = DailyCallOptions & {
      room_url?: string;
      dailyRoom?: string; // for compatibility with old PipecatCloud versions
      dailyToken?: string; // for compatibility with old PipecatCloud versions
    };
    const tmpParams = connectParams as DailyConnectParams;
    if (tmpParams.room_url) {
      tmpParams.url = tmpParams.room_url;
      delete tmpParams.room_url;
    } else if (tmpParams.dailyRoom) {
      tmpParams.url = tmpParams.dailyRoom;
      delete tmpParams.dailyRoom;
    }
    if (tmpParams.dailyToken) {
      tmpParams.token = tmpParams.dailyToken;
      delete tmpParams.dailyToken;
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

    // join() starts media per the connect-time flags when startCamera() has
    // not already, and leaves media already running as it is. From here the
    // flags are frozen for the session. Media counts as started from the
    // moment join() begins: daily-js queues a setLocalAudio() /
    // setLocalVideo() issued while join() is in flight and lands on it, so a
    // toggle during join goes straight through rather than being replayed.
    this._cameraStarted = true;
    try {
      await this._daily.join(this._dailyFactoryOptions);
    } catch (e) {
      // No cleanup here: PipecatClient responds to a connect failure by
      // calling disconnect(), and _disconnect() does the session teardown in
      // one place.
      logger.error("Failed to join room", e);
      this.state = "error";
      throw new TransportStartError();
    }

    if (this._abortController?.signal.aborted) return;

    // initDevices() is not guaranteed to have run before we get here:
    // PipecatClient skips it when both mic and cam start disabled, and on a
    // reconnect once devices are already initialized. _disconnect() stops
    // the observers, so make sure they are running for this session or
    // onLocalAudioLevel / onRemoteAudioLevel never fire.
    await this.startAudioLevelObservers();

    const r = await this._daily.room();
    this._maxMessageSize =
      (r as DailyRoomInfo)?.domainConfig?.max_app_message_size ||
      10 * 1024 * 1024;
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
        // TODO: Consider changing to match the iOS/Android SDKs where
        //       we don't actually set our state to "ready" until
        //       we've received the bot_ready signal
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
              "[Daily Transport] iOS device detected, adding 0.5 second delay before sending ready message"
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
      this._callbacks.onAudioBufferingStopped?.();
    }
  }

  private attachEventListeners() {
    this._daily.on(
      "available-devices-updated",
      this.handleAvailableDevicesUpdated.bind(this)
    );
    this._daily.on(
      "selected-devices-updated",
      this.handleSelectedDevicesUpdated.bind(this)
    );
    this._daily.on("camera-error", this.handleDeviceError.bind(this));

    this._daily.on("track-started", this.handleTrackStarted.bind(this));
    this._daily.on("track-stopped", this.handleTrackStopped.bind(this));
    this._daily.on(
      "participant-joined",
      this.handleParticipantJoined.bind(this)
    );
    this._daily.on("participant-left", this.handleParticipantLeft.bind(this));
    this._daily.on("local-audio-level", this.handleLocalAudioLevel.bind(this));
    this._daily.on(
      "remote-participants-audio-level",
      this.handleRemoteAudioLevel.bind(this)
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

    // leave() tears down daily-js media. Nothing is running now, so the live
    // state goes back to the connect-time flags; see the note on _micEnabled
    // / _camEnabled above.
    this._cameraStarted = false;
    this._micEnabled = !this._dailyFactoryOptions.startAudioOff;
    this._camEnabled = !this._dailyFactoryOptions.startVideoOff;
  }

  public sendMessage(message: RTVIMessage) {
    try {
      this._daily.sendAppMessage(message, "*");
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes("Message data too large")
      ) {
        throw new MessageTooLargeError(error.message);
      }
      throw error;
    }
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
    ev: DailyEventObjectAvailableDevicesUpdated
  ) {
    this._callbacks.onAvailableCamsUpdated?.(
      ev.availableDevices.filter((d) => d.kind === "videoinput")
    );
    this._callbacks.onAvailableMicsUpdated?.(
      ev.availableDevices.filter((d) => d.kind === "audioinput")
    );
    this._callbacks.onAvailableSpeakersUpdated?.(
      ev.availableDevices.filter((d) => d.kind === "audiooutput")
    );
  }

  private handleSelectedDevicesUpdated(
    ev: DailyEventObjectSelectedDevicesUpdated
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

  private async handleLocalAudioTrack(track: MediaStreamTrack) {
    if (this.state == "ready" || !this._bufferLocalAudioUntilBotReady) {
      return;
    }
    const status = this._mediaStreamRecorder.getStatus();
    switch (status) {
      case "ended":
        try {
          await this._mediaStreamRecorder.begin(track);
          await this.startRecording();
        } catch (e) {
          // void. nothing to do.
        }
        break;
      case "paused":
        await this.startRecording();
        break;
      case "recording":
      default:
        if (this._currentAudioTrack !== track) {
          try {
            await this._mediaStreamRecorder.end();
            await this._mediaStreamRecorder.begin(track);
            await this.startRecording();
          } catch (e) {
            // void. nothing to do.
          }
        } else {
          logger.warn(
            "track-started event received for current track and already recording"
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
          : undefined
      );
    } else {
      if (ev.participant?.local) {
        if (ev.track.kind === "audio") {
          this._micEnabled = true;
          void this.handleLocalAudioTrack(ev.track);
        } else if (ev.track.kind === "video") {
          this._camEnabled = true;
        }
      }
      this._callbacks.onTrackStarted?.(
        ev.track,
        ev.participant
          ? dailyParticipantToParticipant(ev.participant)
          : undefined
      );
    }
  }

  private handleTrackStopped(ev: DailyEventObjectTrack) {
    if (ev.type === "screenAudio" || ev.type === "screenVideo") {
      this._callbacks.onScreenTrackStopped?.(
        ev.track,
        ev.participant
          ? dailyParticipantToParticipant(ev.participant)
          : undefined
      );
    } else {
      // Tracks also stop when leave() tears the session down; by then the
      // live state has been reset to the connect-time flags, so leave it.
      if (ev.participant?.local && this._cameraStarted) {
        if (ev.track.kind === "audio") {
          this._micEnabled = false;
        } else if (ev.track.kind === "video") {
          this._camEnabled = false;
        }
      }
      this._callbacks.onTrackStopped?.(
        ev.track,
        ev.participant
          ? dailyParticipantToParticipant(ev.participant)
          : undefined
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
    ev: DailyEventObjectRemoteParticipantsAudioLevel
  ) {
    const participants = this._daily.participants();
    const ids = Object.keys(ev.participantsAudioLevel);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const level = ev.participantsAudioLevel[id];
      this._callbacks.onRemoteAudioLevel?.(
        level,
        dailyParticipantToParticipant(participants[id])
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
