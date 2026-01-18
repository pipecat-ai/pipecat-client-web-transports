import {
  DeviceError,
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
  DataPacket_Kind,
} from "livekit-client";

type ConnectionParam =
  | {
      authUrl: string;
    }
  | {
      roomUrl: string;
      roomToken: string;
    };

export type LiveKitTransportConstructorOptions = RoomOptions & ConnectionParam;

export interface LiveKitConnectParams extends RoomConnectOptions {
  url: string;
  token: string;
  authUrl?: string;
}

export class LiveKitTransport extends Transport {
  private _room: Room;
  private _roomOptions: RoomOptions;
  private _authUrl: string | null = null;
  private _roomUrl: string | null = null;
  private _roomToken: string | null = null;
  protected _options!: PipecatClientOptions;

  private _selectedMic: MediaDeviceInfo | Record<string, never> = {};
  private _selectedCam: MediaDeviceInfo | Record<string, never> = {};
  private _selectedSpeaker: MediaDeviceInfo | Record<string, never> = {};

  protected _state: TransportState = "disconnected";
  protected _callbacks: RTVIEventCallbacks = {};

  constructor(options: LiveKitTransportConstructorOptions) {
    super();
    if ("authUrl" in options) {
      this._authUrl = options.authUrl;
    } else {
      this._roomToken = options.roomToken;
      this._roomUrl = options.roomUrl;
    }
    this._roomOptions = options;
    this._room = new Room(this._roomOptions);
  }

  public initialize(
    options: PipecatClientOptions,
    messageHandler: (ev: RTVIMessage) => void,
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._onMessage = messageHandler;

    this.attachEventListeners();

    this.state = "disconnected";
    logger.debug("[LiveKit Transport] Initialized");
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

    // In LiveKit, we can pre-warm devices or just enumerate
    // We'll enumerate first
    await this.updateAvailableDevices();

    // Enable devices based on options if needed, but usually this happens on connect or explicitly
    // For now, we just mark as initialized
    this.state = "initialized";
  }

  private async updateAvailableDevices() {
    // LiveKit helper for listing devices
    // Note: LiveKit's Room doesn't strictly expose enumerateDevices directly as a static helper in all versions,
    // but we can use navigator.mediaDevices directly or Room.getLocalDevices helper if available.
    // We will use navigator.mediaDevices standard API for enumeration as it is robust.

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      const mics = devices.filter((d) => d.kind === "audioinput");
      const speakers = devices.filter((d) => d.kind === "audiooutput");

      this._callbacks.onAvailableCamsUpdated?.(cams);
      this._callbacks.onAvailableMicsUpdated?.(mics);
      this._callbacks.onAvailableSpeakersUpdated?.(speakers);

      // We can't easily know "selected" device without querying the Room's LocalParticipant or active device
      // But initially none is selected until we start tracks.
    } catch (e) {
      logger.error("Error enumerating devices", e);
    }
  }

  _validateConnectionParams(
    connectParams: unknown,
  ): LiveKitConnectParams | undefined {
    if (!connectParams || typeof connectParams !== "object") return undefined;
    return connectParams as LiveKitConnectParams;
  }

  async _connect(connectParams?: LiveKitConnectParams): Promise<void> {
    if (!this._room) {
      throw new RTVIError("Transport instance not initialized");
    }

    let url = this._roomUrl;
    let token = this._roomToken;
    const authUrl = this._authUrl;

    if (!url || !token) {
      if (authUrl) {
        try {
          const res = await fetch(authUrl);
          const json = await res.json();
          url = json.url;
          token = json.token;
        } catch (e) {
          logger.error("Failed to fetch LiveKit credentials from authUrl", e);
          this.state = "error";
          throw new TransportStartError("Failed to fetch credentials");
        }
      }
    }

    if (!url || !token) {
      logger.error(
        "LiveKit connection requires 'roomUrl' and 'roomToken' or 'authUrl'",
      );
      this.state = "error";
      throw new TransportStartError("Missing url or token");
    }

    this._roomUrl = url;
    this._roomToken = token;

    this.state = "connecting";

    try {
      await this._room.connect(url, token, connectParams);
      const enableMic = this._options.enableMic || false;
      const enableCam = this._options.enableCam || false;
      await this._room.localParticipant.setMicrophoneEnabled(enableMic);
      if (this._isMediaDeviceInfo(this._selectedMic)) {
        this._callbacks.onMicUpdated?.(this._selectedMic);
      }
      await this._room.localParticipant.setCameraEnabled(enableCam);
      if (this._isMediaDeviceInfo(this._selectedCam)) {
        this._callbacks.onCamUpdated?.(this._selectedCam);
      }
    } catch (e) {
      logger.error("Failed to connect to LiveKit room", e);
      this.state = "error";
      throw new TransportStartError();
    }

    if (this._abortController?.signal.aborted) {
      await this._room.disconnect();
      return;
    }

    this.state = "connected";
    this._callbacks.onConnected?.();
  }

  async _disconnect(): Promise<void> {
    this.state = "disconnecting";
    if (this._room) {
      await this._room.disconnect();
    }
    this.state = "disconnected";
    this._callbacks.onDisconnected?.();
  }

  sendMessage(message: RTVIMessage): void {
    if (!this._room || (this.state !== "connected" && this.state !== "ready")) {
      logger.warn("Cannot send message, not connected");
      return;
    }
    const str = JSON.stringify(message);
    const encoder = new TextEncoder();
    const data = encoder.encode(str);

    // Publish to room
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

  updateMic(micId: string): void {
    this._room
      .switchActiveDevice("audioinput", micId)
      .then(() => {
        // Update selected mic
        this.getAllMics().then((mics) => {
          const mic = mics.find((m) => m.deviceId === micId);
          if (mic) {
            this._selectedMic = mic;
            this._callbacks.onMicUpdated?.(mic);
          }
        });
      })
      .catch((e) => {
        this._callbacks.onDeviceError?.(
          new DeviceError(["mic"], "unknown", e.message),
        );
      });
  }

  updateCam(camId: string): void {
    this._room
      .switchActiveDevice("videoinput", camId)
      .then(() => {
        this.getAllCams().then((cams) => {
          const cam = cams.find((c) => c.deviceId === camId);
          if (cam) {
            this._selectedCam = cam;
            this._callbacks.onCamUpdated?.(cam);
          }
        });
      })
      .catch((e) => {
        this._callbacks.onDeviceError?.(
          new DeviceError(["cam"], "unknown", e.message),
        );
      });
  }

  updateSpeaker(speakerId: string): void {
    this._room
      .switchActiveDevice("audiooutput", speakerId)
      .then(() => {
        this.getAllSpeakers().then((speakers) => {
          const s = speakers.find((d) => d.deviceId === speakerId);
          if (s) {
            this._selectedSpeaker = s;
            this._callbacks.onSpeakerUpdated?.(s);
          }
        });
      })
      .catch((e) => {
        this._callbacks.onDeviceError?.(
          new DeviceError(["speaker"], "unknown", e.message),
        );
      });
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
      .then(() => {
        // Check if we need to update the selected mic (device ID might have changed or was never set)
        // If enabling, and we don't have a selected mic, or we just want to be sure:
        if (enable) {
          // Try to find the active mic track to get the deviceId
          const trackPub = this._room.localParticipant.getTrackPublication(
            Track.Source.Microphone,
          );
          if (trackPub?.track?.mediaStreamTrack) {
            const deviceId =
              trackPub.track.mediaStreamTrack.getSettings().deviceId;
            if (deviceId) {
              this.getAllMics().then((mics) => {
                const mic = mics.find((m) => m.deviceId === deviceId);
                if (mic) {
                  this._selectedMic = mic;
                }
                // Always emit update with what we have
                if (this._isMediaDeviceInfo(this._selectedMic)) {
                  this._callbacks.onMicUpdated?.(this._selectedMic);
                }
              });
              return;
            }
          }
        }
        // Emit update to notify listeners (e.g. PipecatClientMicToggle)
        if (this._isMediaDeviceInfo(this._selectedMic)) {
          this._callbacks.onMicUpdated?.(this._selectedMic);
        }
      })
      .catch((e) => {
        logger.error("Failed to toggle mic", e);
        this._callbacks.onDeviceError?.(
          new DeviceError(["mic"], "unknown", e.message),
        );
      });
  }

  enableCam(enable: boolean): void {
    this._room.localParticipant
      .setCameraEnabled(enable)
      .then(() => {
        if (enable) {
          const trackPub = this._room.localParticipant.getTrackPublication(
            Track.Source.Camera,
          );
          if (trackPub?.track?.mediaStreamTrack) {
            const deviceId =
              trackPub.track.mediaStreamTrack.getSettings().deviceId;
            if (deviceId) {
              this.getAllCams().then((cams) => {
                const cam = cams.find((c) => c.deviceId === deviceId);
                if (cam) {
                  this._selectedCam = cam;
                }
                if (this._isMediaDeviceInfo(this._selectedCam)) {
                  this._callbacks.onCamUpdated?.(this._selectedCam);
                }
              });
              return;
            }
          }
        }
        // Emit update to notify listeners
        if (this._isMediaDeviceInfo(this._selectedCam)) {
          this._callbacks.onCamUpdated?.(this._selectedCam);
        }
      })
      .catch((e) => {
        logger.error("Failed to toggle cam", e);
        this._callbacks.onDeviceError?.(
          new DeviceError(["cam"], "unknown", e.message),
        );
      });
  }

  private _isMediaDeviceInfo(
    device: MediaDeviceInfo | Record<string, never>,
  ): device is MediaDeviceInfo {
    return (device as MediaDeviceInfo).deviceId !== undefined;
  }

  get isMicEnabled(): boolean {
    return this._room.localParticipant.isMicrophoneEnabled;
  }

  get isCamEnabled(): boolean {
    return this._room.localParticipant.isCameraEnabled;
  }

  get isSharingScreen(): boolean {
    return this._room.localParticipant.isScreenShareEnabled;
  }

  enableScreenShare(enable: boolean): void {
    this._room.localParticipant.setScreenShareEnabled(enable);
  }

  tracks(): Tracks {
    // Map LiveKit tracks to RTVI Tracks
    const local = this._room.localParticipant;
    // We need MediaStreamTrack
    const getTrack = (
      p: LocalParticipant | RemoteParticipant,
      kind: string,
      source: Track.Source,
    ) => {
      const pub = p.getTrackPublication(source);
      return pub?.track?.mediaStreamTrack;
    };

    // Assuming Bot is one of the remote participants.
    // We might need logic to identify WHO is the bot.
    // For now, we'll traverse remote participants and look for one typical for a bot?
    // Or just return the first one with audio?
    // Pipecat usually establishes checking identity.

    // For now, we return local tracks correctly.
    const localTracks = {
      audio: getTrack(local, "audio", Track.Source.Microphone),
      video: getTrack(local, "video", Track.Source.Camera),
      screenVideo: getTrack(local, "video", Track.Source.ScreenShare),
      screenAudio: getTrack(local, "audio", Track.Source.ScreenShareAudio),
    };

    // Find bot tracks
    // This is heuristics unless we have bot identity.
    // Usually the backend transport is the "bot".
    // LiveKit room might have multiple participants.
    // We can look for a participant named "bot" or check assumptions.
    // DailyTransport uses `this._botId`.

    const botTracks = {};
    // Simplification: use the first remote participant as bot if not specified otherwise
    // Ideally we should handle participant-joined and identify the bot.

    return { local: localTracks, bot: botTracks };
  }

  sendReadyMessage(): void {
    this.state = "ready";
    this.sendMessage(RTVIMessage.clientReady());
  }

  private attachEventListeners() {
    if (!this._room) return;

    this._room
      .on(RoomEvent.DataReceived, this.handleDataReceived.bind(this))
      .on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed.bind(this))
      .on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed.bind(this))
      .on(
        RoomEvent.ParticipantConnected,
        this.handleParticipantConnected.bind(this),
      )
      .on(
        RoomEvent.ParticipantDisconnected,
        this.handleParticipantDisconnected.bind(this),
      )
      .on(RoomEvent.Disconnected, this.handleRoomDisconnected.bind(this))
      .on(
        RoomEvent.LocalTrackPublished,
        this.handleLocalTrackPublished.bind(this),
      )
      .on(
        RoomEvent.LocalTrackUnpublished,
        this.handleLocalTrackUnpublished.bind(this),
      )
      .on(RoomEvent.MediaDevicesError, this.handleMediaDevicesError.bind(this));

    // Also handle device changes if available
    navigator.mediaDevices.ondevicechange = () => {
      this.updateAvailableDevices();
    };
  }

  private handleDataReceived(
    payload: Uint8Array,
    participant?: RemoteParticipant,
    kind?: DataPacket_Kind,
    topic?: string,
  ) {
    // Decode
    try {
      const decoder = new TextDecoder();
      const str = decoder.decode(payload);
      const msg = JSON.parse(str); // Temporary cast to check type
      // Check if it looks like RTVIMessage
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
    participant: RemoteParticipant,
  ) {
    this._callbacks.onTrackStarted?.(
      track.mediaStreamTrack,
      this.toParticipant(participant),
    );
  }

  private handleTrackUnsubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) {
    if (track.mediaStreamTrack) {
      this._callbacks.onTrackStopped?.(
        track.mediaStreamTrack,
        this.toParticipant(participant),
      );
    }
  }

  private handleLocalTrackPublished(
    publication: LocalTrackPublication,
    participant: LocalParticipant,
  ) {
    if (publication.track?.mediaStreamTrack) {
      this._callbacks.onTrackStarted?.(
        publication.track.mediaStreamTrack,
        this.toParticipant(participant),
      );
    }
  }

  private handleLocalTrackUnpublished(
    publication: LocalTrackPublication,
    participant: LocalParticipant,
  ) {
    if (publication.track?.mediaStreamTrack) {
      this._callbacks.onTrackStopped?.(
        publication.track.mediaStreamTrack,
        this.toParticipant(participant),
      );
    }
  }

  private handleParticipantConnected(participant: RemoteParticipant) {
    this._callbacks.onParticipantJoined?.(this.toParticipant(participant));
    // Potential bot identification logic here
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
      new DeviceError(["cam", "mic"], "unknown", e.message),
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
