import {
  logger,
  makeRequest,
  RTVIError,
  RTVIMessage,
  PipecatClientOptions,
  Tracks,
  Transport,
  TransportStartError,
  TransportState,
  UnsupportedFeatureError,
  APIRequest,
  isAPIRequest,
} from "@pipecat-ai/client-js";
import { MediaManager } from "../../../lib/media-mgmt/mediaManager";
import { DailyMediaManager } from "../../../lib/media-mgmt/dailyMediaManager";

class TrackStatusMessage {
  type = "trackStatus";
  receiver_index: number;
  enabled: boolean;
  constructor(receiver_index: number, enabled: boolean) {
    this.receiver_index = receiver_index;
    this.enabled = enabled;
  }
}

class WebRTCTrack {
  track: MediaStreamTrack;
  status: "new" | "muted" | "unmuted" | "ended";

  constructor(track: MediaStreamTrack) {
    this.track = track;
    this.status = "new";
  }
}

export interface SmallWebRTCTransportConstructorOptions {
  iceServers?: RTCIceServer[];
  waitForICEGathering?: boolean;
  /** @deprecated Use webrtcUrl instead */
  connectionUrl?: string;
  webrtcUrl?: string | APIRequest;
  audioCodec?: string;
  videoCodec?: string;
  mediaManager?: MediaManager;
}

export type SmallWebRTCTransportConnectionOptions = {
  /** @deprecated Use webrtcUrl instead */
  connectionUrl?: string;
  webrtcUrl?: string | APIRequest;
};

const RENEGOTIATE_TYPE = "renegotiate";
class RenegotiateMessage {
  type = RENEGOTIATE_TYPE;
}

const PEER_LEFT_TYPE = "peerLeft";
class PeerLeftMessageMessage {
  type = PEER_LEFT_TYPE;
}

type OutboundSignallingMessage = TrackStatusMessage;

type InboundSignallingMessage = RenegotiateMessage | PeerLeftMessageMessage;

// Interface for the structure of the signalling message
const SIGNALLING_TYPE = "signalling";
class SignallingMessageObject {
  type: typeof SIGNALLING_TYPE = SIGNALLING_TYPE;
  message: InboundSignallingMessage | OutboundSignallingMessage;
  constructor(message: InboundSignallingMessage | OutboundSignallingMessage) {
    this.message = message;
  }
}

const AUDIO_TRANSCEIVER_INDEX = 0;
const VIDEO_TRANSCEIVER_INDEX = 1;
const SCREEN_VIDEO_TRANSCEIVER_INDEX = 2;

/**
 * SmallWebRTCTransport is a class that provides a client-side
 * interface for connecting to the SmallWebRTCTransport provided by Pipecat
 */
export class SmallWebRTCTransport extends Transport {
  public static SERVICE_NAME = "small-webrtc-transport";

  private _offerRequest: APIRequest | null = null;

  // Trigger when the peer connection is finally ready or in case it has failed all the attempts to connect
  private _connectResolved: ((value: PromiseLike<void> | void) => void) | null =
    null;
  private _connectFailed: ((reason?: any) => void) | null = null;

  // Utilities for audio.
  declare private mediaManager: MediaManager;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioCodec: string | null | "default" = null;
  private videoCodec: string | null | "default" = null;
  private pc_id: string | null = null;

  private reconnectionAttempts = 0;
  private maxReconnectionAttempts = 3;
  private isReconnecting = false;
  private keepAliveInterval: number | null = null;

  private _iceServers: RTCIceServer[] = [];
  private readonly _waitForICEGathering: boolean;

  private _incomingTracks: Map<string, WebRTCTrack> = new Map();

  constructor(opts: SmallWebRTCTransportConstructorOptions = {}) {
    super();
    this._iceServers = opts.iceServers ?? [];
    this._waitForICEGathering = opts.waitForICEGathering ?? false;
    this.audioCodec = opts.audioCodec ?? null;
    this.videoCodec = opts.videoCodec ?? null;

    const _webrtcUrl = opts.webrtcUrl ?? opts.connectionUrl ?? null;
    if (opts.connectionUrl) {
      logger.warn("connectionUrl is deprecated, use webrtcUrl instead");
    }
    if (_webrtcUrl) {
      if (typeof _webrtcUrl === "string") {
        this._offerRequest = { endpoint: _webrtcUrl };
      } else if (isAPIRequest(_webrtcUrl)) {
        this._offerRequest = _webrtcUrl;
      } else {
        logger.error("Invalid webrtcUrl provided for connection. Ignoring.");
      }
    }

    this.mediaManager =
      opts.mediaManager ||
      new DailyMediaManager(
        false,
        false,
        async (event) => {
          if (!this.pc) {
            return;
          }
          if (event.type == "audio") {
            logger.info("SmallWebRTCMediaManager replacing audio track");
            await this.getAudioTransceiver().sender.replaceTrack(event.track);
          } else if (event.type == "video") {
            logger.info("SmallWebRTCMediaManager replacing video track");
            await this.getVideoTransceiver().sender.replaceTrack(event.track);
          } else if (event.type == "screenVideo") {
            logger.info("SmallWebRTCMediaManager replacing screen video track");
            await this.getScreenVideoTransceiver().sender.replaceTrack(
              event.track,
            );
          } else if (event.type == "screenAudio") {
            logger.info(
              "SmallWebRTCMediaManager does not yet support screen audio. Track is ignored.",
            );
          }
        },
        (event) =>
          logger.debug("SmallWebRTCMediaManager Track stopped:", event),
      );
  }

  public initialize(
    options: PipecatClientOptions,
    messageHandler: (ev: RTVIMessage) => void,
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._onMessage = messageHandler;
    this.mediaManager.setClientOptions(options);

    this.state = "disconnected";
    logger.debug("[RTVI Transport] Initialized");
  }

  async initDevices() {
    this.state = "initializing";
    await this.mediaManager.initialize();
    this.state = "initialized";
  }

  setAudioCodec(audioCodec: string | null): void {
    this.audioCodec = audioCodec;
  }

  setVideoCodec(videoCodec: string | null): void {
    this.videoCodec = videoCodec;
  }

  _validateConnectionParams(
    connectParams: unknown,
  ): SmallWebRTCTransportConnectionOptions | undefined {
    if (connectParams === undefined || connectParams === null) {
      return undefined;
    }
    if (typeof connectParams !== "object") {
      throw new RTVIError("Invalid connection parameters");
    }
    const snakeToCamel = (snakeCaseString: string) => {
      return snakeCaseString.replace(/_([a-z,A-Z])/g, (_, letter) =>
        letter.toUpperCase(),
      );
    };
    const fixedParams: SmallWebRTCTransportConnectionOptions = {};
    for (const [key, val] of Object.entries(connectParams)) {
      const camelKey = snakeToCamel(key);
      if (camelKey !== "webrtcUrl" && camelKey !== "connectionUrl") {
        throw new RTVIError(
          `Unrecognized connection parameter: ${key}. Only 'webrtcUrl' or 'connectionUrl' are allowed.`,
        );
      } else if (typeof val !== "string") {
        throw new RTVIError(
          `Invalid type for ${key}: expected string, got ${typeof val}`,
        );
      }
      if (camelKey === "connectionUrl") {
        logger.warn("connectionUrl is deprecated, use webrtcUrl instead");
      }
      fixedParams[camelKey] = val;
    }
    return fixedParams;
  }

  async _connect(
    connectParams?: SmallWebRTCTransportConnectionOptions,
  ): Promise<void> {
    if (this._abortController?.signal.aborted) return;

    this.state = "connecting";

    const _webrtcUrl =
      connectParams?.webrtcUrl ?? connectParams?.connectionUrl ?? null;
    if (connectParams?.connectionUrl) {
      logger.warn("connectionUrl is deprecated, use webrtcUrl instead");
    }
    if (_webrtcUrl) {
      if (typeof _webrtcUrl === "string") {
        this._offerRequest = { endpoint: _webrtcUrl };
      } else if (isAPIRequest(_webrtcUrl)) {
        this._offerRequest = _webrtcUrl;
      } else {
        logger.error("Invalid webrtcUrl provided in params. Ignoring.");
      }
    }
    if (!this._offerRequest) {
      logger.error("No request details for connection");
      this.state = "error";
      throw new TransportStartError();
    }

    await this.mediaManager.connect();

    await this.startNewPeerConnection();

    if (this._abortController?.signal.aborted) return;

    // Wait until we are actually connected and the data channel is ready
    await new Promise<void>((resolve, reject) => {
      this._connectResolved = resolve;
      this._connectFailed = reject;
    });

    this.state = "connected";
    this._callbacks.onConnected?.();
  }

  private syncTrackStatus() {
    // Sending the current status from the tracks to Pipecat
    this.sendSignallingMessage(
      new TrackStatusMessage(
        AUDIO_TRANSCEIVER_INDEX,
        this.mediaManager.isMicEnabled,
      ),
    );
    this.sendSignallingMessage(
      new TrackStatusMessage(
        VIDEO_TRANSCEIVER_INDEX,
        this.mediaManager.isCamEnabled,
      ),
    );
    if (this.mediaManager.supportsScreenShare) {
      this.sendSignallingMessage(
        new TrackStatusMessage(
          SCREEN_VIDEO_TRANSCEIVER_INDEX,
          this.mediaManager.isSharingScreen &&
            !!this.mediaManager.tracks().local.screenVideo,
        ),
      );
    }
  }

  sendReadyMessage() {
    this.state = "ready";
    // Sending message that the client is ready, just for testing
    //this.dc?.send(JSON.stringify({id: 'clientReady', label: 'rtvi-ai', type:'client-ready'}))
    this.sendMessage(RTVIMessage.clientReady());
  }

  sendMessage(message: RTVIMessage) {
    if (!this.dc || this.dc.readyState !== "open") {
      logger.warn(`Datachannel is not ready. Message not sent: ${message}`);
      return;
    }
    this.dc?.send(JSON.stringify(message));
  }

  private sendSignallingMessage(message: OutboundSignallingMessage) {
    if (!this.dc || this.dc.readyState !== "open") {
      logger.warn(`Datachannel is not ready. Message not sent: ${message}`);
      return;
    }
    const signallingMessage = new SignallingMessageObject(message);
    this.dc?.send(JSON.stringify(signallingMessage));
  }

  async _disconnect(): Promise<void> {
    this.state = "disconnecting";
    await this.stop();
    this.state = "disconnected";
  }

  private createPeerConnection(): RTCPeerConnection {
    const config: RTCConfiguration = {
      iceServers: this._iceServers,
    };

    let pc = new RTCPeerConnection(config);

    pc.addEventListener("icegatheringstatechange", () => {
      logger.debug(`iceGatheringState: ${this.pc!.iceGatheringState}`);
    });
    logger.debug(`iceGatheringState: ${pc.iceGatheringState}`);

    pc.addEventListener("iceconnectionstatechange", () =>
      this.handleICEConnectionStateChange(),
    );

    logger.debug(`iceConnectionState: ${pc.iceConnectionState}`);

    pc.addEventListener("signalingstatechange", () => {
      logger.debug(`signalingState: ${this.pc!.signalingState}`);
      if (this.pc!.signalingState == "stable") {
        this.handleReconnectionCompleted();
      }
    });
    logger.debug(`signalingState: ${pc.signalingState}`);

    pc.addEventListener("track", (evt: RTCTrackEvent) => {
      const streamType = evt.transceiver
        ? evt.transceiver.mid === "0"
          ? "microphone"
          : evt.transceiver.mid === "1"
            ? "camera"
            : "screenVideo"
        : null;
      if (!streamType) {
        logger.warn("Received track without transceiver mid", evt);
        return;
      }
      logger.debug(`Received new remote track for ${streamType}`);
      this._incomingTracks.set(streamType, new WebRTCTrack(evt.track));
      evt.track.addEventListener("unmute", () => {
        const t = this._incomingTracks.get(streamType);
        if (!t) return;
        logger.debug(`Remote track unmuted: ${streamType}`);
        t.status = "unmuted";
        this._callbacks.onTrackStarted?.(evt.track);
      });
      evt.track.addEventListener("mute", () => {
        const t = this._incomingTracks.get(streamType);
        if (!t || t.status !== "unmuted") return;
        logger.debug(`Remote track muted: ${streamType}`);
        t.status = "muted";
        this._callbacks.onTrackStopped?.(evt.track);
      });
      evt.track.addEventListener("ended", () => {
        logger.debug(`Remote track ended: ${streamType}`);
        this._callbacks.onTrackStopped?.(evt.track);
        this._incomingTracks.delete(streamType);
      });
    });

    return pc;
  }

  private handleICEConnectionStateChange(): void {
    if (!this.pc) return;
    logger.debug(`ICE Connection State: ${this.pc.iceConnectionState}`);

    if (this.pc.iceConnectionState === "failed") {
      logger.debug("ICE connection failed, attempting restart.");
      void this.attemptReconnection(true);
    } else if (this.pc.iceConnectionState === "disconnected") {
      // Waiting before trying to reconnect to see if it handles it automatically
      setTimeout(() => {
        if (this.pc?.iceConnectionState === "disconnected") {
          logger.debug("Still disconnected, attempting reconnection.");
          void this.attemptReconnection(true);
        }
      }, 5000);
    }
  }

  private handleReconnectionCompleted() {
    this.reconnectionAttempts = 0;
    this.isReconnecting = false;
  }

  private async attemptReconnection(
    recreatePeerConnection: boolean = false,
  ): Promise<void> {
    if (this.isReconnecting) {
      logger.debug("Reconnection already in progress, skipping.");
      return;
    }
    if (this.reconnectionAttempts >= this.maxReconnectionAttempts) {
      logger.debug("Max reconnection attempts reached. Stopping transport.");
      await this.stop();
      return;
    }
    this.isReconnecting = true;
    this.reconnectionAttempts++;
    logger.debug(`Reconnection attempt ${this.reconnectionAttempts}...`);
    // aiortc does not seem to work when just trying to restart the ice
    // so for this case we create a new peer connection on both sides
    if (recreatePeerConnection) {
      const oldPC = this.pc;
      await this.startNewPeerConnection(recreatePeerConnection);
      if (oldPC) {
        logger.debug("closing old peer connection");
        this.closePeerConnection(oldPC);
      }
    } else {
      await this.negotiate();
    }
  }

  private async negotiate(
    recreatePeerConnection: boolean = false,
  ): Promise<void> {
    if (!this.pc) {
      return Promise.reject("Peer connection is not initialized");
    }
    if (!this._offerRequest) {
      logger.error("No request details provided for connection");
      this.state = "error";
      throw new TransportStartError();
    }

    try {
      // Create offer
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete
      if (this._waitForICEGathering) {
        await new Promise<void>((resolve) => {
          if (this.pc!.iceGatheringState === "complete") {
            resolve();
          } else {
            const checkState = () => {
              if (this.pc!.iceGatheringState === "complete") {
                this.pc!.removeEventListener(
                  "icegatheringstatechange",
                  checkState,
                );
                resolve();
              }
            };
            this.pc!.addEventListener("icegatheringstatechange", checkState);
          }
        });
      }

      let offerSdp = this.pc!.localDescription!;
      // Filter audio codec
      if (this.audioCodec && this.audioCodec !== "default") {
        // @ts-ignore
        offerSdp.sdp = this.sdpFilterCodec(
          "audio",
          this.audioCodec,
          offerSdp.sdp,
        );
      }
      // Filter video codec
      if (this.videoCodec && this.videoCodec !== "default") {
        // @ts-ignore
        offerSdp.sdp = this.sdpFilterCodec(
          "video",
          this.videoCodec,
          offerSdp.sdp,
        );
      }

      logger.debug(`Will create offer for peerId: ${this.pc_id}`);

      // Send offer to server
      const request = { ...this._offerRequest };
      const requestData: {
        sdp: string;
        type: string;
        pc_id: string | null;
        restart_pc: boolean;
        requestData?: any;
      } = {
        sdp: offerSdp.sdp,
        type: offerSdp.type as string,
        pc_id: this.pc_id,
        restart_pc: recreatePeerConnection,
      };
      if (this._offerRequest.requestData) {
        requestData.requestData = this._offerRequest.requestData;
      }
      request.requestData = requestData;
      const answer: RTCSessionDescriptionInit = (await makeRequest(
        request,
      )) as RTCSessionDescriptionInit;

      // @ts-ignore
      this.pc_id = answer.pc_id;
      // @ts-ignore
      logger.debug(`Received answer for peer connection id ${answer.pc_id}`);
      await this.pc!.setRemoteDescription(answer);
      logger.debug(
        `Remote candidate supports trickle ice: ${this.pc.canTrickleIceCandidates}`,
      );
    } catch (e) {
      logger.debug(
        `Reconnection attempt ${this.reconnectionAttempts} failed: ${e}`,
      );
      this.isReconnecting = false;
      setTimeout(() => this.attemptReconnection(true), 2000);
    }
  }

  private addInitialTransceivers() {
    // Transceivers always appear in creation-order for both peers
    // For now we support 3 transceivers meant to hold the following
    // tracks in the given order:
    // audio, video, screenVideo
    this.pc!.addTransceiver("audio", { direction: "sendrecv" });
    this.pc!.addTransceiver("video", { direction: "sendrecv" });
    if (this.mediaManager.supportsScreenShare) {
      // For now, we only support receiving a single video track
      this.pc!.addTransceiver("video", { direction: "sendonly" });
    }
  }

  private getAudioTransceiver() {
    // Transceivers always appear in creation-order for both peers
    // Look at addInitialTransceivers
    return this.pc!.getTransceivers()[AUDIO_TRANSCEIVER_INDEX];
  }

  private getVideoTransceiver() {
    // Transceivers always appear in creation-order for both peers
    // Look at addInitialTransceivers
    return this.pc!.getTransceivers()[VIDEO_TRANSCEIVER_INDEX];
  }

  private getScreenVideoTransceiver() {
    // Transceivers always appear in creation-order for both peers
    // Look at addInitialTransceivers
    return this.pc!.getTransceivers()[SCREEN_VIDEO_TRANSCEIVER_INDEX];
  }

  private async startNewPeerConnection(
    recreatePeerConnection: boolean = false,
  ) {
    this.pc = this.createPeerConnection();
    this.addInitialTransceivers();
    this.dc = this.createDataChannel("chat", { ordered: true });
    await this.addUserMedia();
    await this.negotiate(recreatePeerConnection);
  }

  private async addUserMedia(): Promise<void> {
    logger.debug(`addUserMedia this.tracks(): ${this.tracks()}`);

    let audioTrack = this.tracks().local.audio;
    logger.debug(`addUserMedia audioTrack: ${audioTrack}`);
    if (audioTrack) {
      await this.getAudioTransceiver().sender.replaceTrack(audioTrack);
    }

    let videoTrack = this.tracks().local.video;
    logger.debug(`addUserMedia videoTrack: ${videoTrack}`);
    if (videoTrack) {
      await this.getVideoTransceiver().sender.replaceTrack(videoTrack);
    }

    if (this.mediaManager.supportsScreenShare) {
      videoTrack = this.tracks().local.screenVideo;
      logger.debug(`addUserMedia screenVideoTrack: ${videoTrack}`);
      if (videoTrack) {
        await this.getScreenVideoTransceiver().sender.replaceTrack(videoTrack);
      }
    }
  }

  // Method to handle a general message (this can be expanded for other types of messages)
  handleMessage(message: string): void {
    try {
      const messageObj = JSON.parse(message); // Type is `any` initially
      logger.debug("received message:", messageObj);

      // Check if it's a signalling message
      if (messageObj.type === SIGNALLING_TYPE) {
        void this.handleSignallingMessage(
          messageObj as SignallingMessageObject,
        ); // Delegate to handleSignallingMessage
      } else {
        // Bubble any messages with rtvi-ai label
        if (messageObj.label === "rtvi-ai") {
          this._onMessage({
            id: messageObj.id,
            type: messageObj.type,
            data: messageObj.data,
          } as RTVIMessage);
        }
      }
    } catch (error) {
      console.error("Failed to parse JSON message:", error);
    }
  }

  // Method to handle signalling messages specifically
  async handleSignallingMessage(
    messageObj: SignallingMessageObject,
  ): Promise<void> {
    // Cast the object to the correct type after verification
    const signallingMessage = messageObj as SignallingMessageObject;

    // Handle different signalling message types
    switch (signallingMessage.message.type) {
      case RENEGOTIATE_TYPE:
        void this.attemptReconnection(false);
        break;
      case PEER_LEFT_TYPE:
        void this.disconnect();
        break;
      default:
        console.warn("Unknown signalling message:", signallingMessage.message);
    }
  }

  private createDataChannel(
    label: string,
    options: RTCDataChannelInit,
  ): RTCDataChannel {
    const dc = this.pc!.createDataChannel(label, options);

    dc.addEventListener("close", () => {
      logger.debug("datachannel closed");
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
      }
    });

    dc.addEventListener("open", () => {
      logger.debug("datachannel opened");
      if (this._connectResolved) {
        this.syncTrackStatus();
        this._connectResolved();
        this._connectResolved = null;
        this._connectFailed = null;
      }
      // @ts-ignore
      this.keepAliveInterval = setInterval(() => {
        const message = "ping: " + new Date().getTime();
        dc.send(message);
      }, 1000);
    });

    dc.addEventListener("message", (evt: MessageEvent) => {
      let message = evt.data;
      this.handleMessage(message);
    });

    return dc;
  }

  private closePeerConnection(pc: RTCPeerConnection) {
    pc.getTransceivers().forEach((transceiver) => {
      if (transceiver.stop) {
        transceiver.stop();
      }
    });

    pc.getSenders().forEach((sender) => {
      sender.track?.stop();
    });

    pc.close();
  }

  private async stop(): Promise<void> {
    if (!this.pc) {
      logger.debug("Peer connection is already closed or null.");
      return;
    }

    if (this.dc) {
      this.dc.close();
    }

    this.closePeerConnection(this.pc);
    this.pc = null;

    await this.mediaManager.disconnect();

    // For some reason after we close the peer connection, it is not triggering the listeners
    this.pc_id = null;
    this.reconnectionAttempts = 0;
    this.isReconnecting = false;
    this._callbacks.onDisconnected?.();

    if (this._connectFailed) {
      this._connectFailed();
    }
    this._connectFailed = null;
    this._connectResolved = null;
  }

  getAllMics(): Promise<MediaDeviceInfo[]> {
    return this.mediaManager.getAllMics();
  }
  getAllCams(): Promise<MediaDeviceInfo[]> {
    return this.mediaManager.getAllCams();
  }
  getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    return this.mediaManager.getAllSpeakers();
  }

  async updateMic(micId: string): Promise<void> {
    return this.mediaManager.updateMic(micId);
  }
  updateCam(camId: string): void {
    return this.mediaManager.updateCam(camId);
  }
  updateSpeaker(speakerId: string): void {
    return this.mediaManager.updateSpeaker(speakerId);
  }

  get selectedMic(): MediaDeviceInfo | Record<string, never> {
    return this.mediaManager.selectedMic;
  }
  get selectedCam(): MediaDeviceInfo | Record<string, never> {
    return this.mediaManager.selectedCam;
  }
  get selectedSpeaker(): MediaDeviceInfo | Record<string, never> {
    return this.mediaManager.selectedSpeaker;
  }

  set iceServers(iceServers: RTCIceServer[]) {
    this._iceServers = iceServers;
  }

  get iceServers() {
    return this._iceServers;
  }

  enableMic(enable: boolean): void {
    this.mediaManager.enableMic(enable);
    this.sendSignallingMessage(
      new TrackStatusMessage(AUDIO_TRANSCEIVER_INDEX, enable),
    );
  }
  enableCam(enable: boolean): void {
    this.mediaManager.enableCam(enable);
    this.sendSignallingMessage(
      new TrackStatusMessage(VIDEO_TRANSCEIVER_INDEX, enable),
    );
  }
  async enableScreenShare(enable: boolean): Promise<void> {
    if (!this.mediaManager.supportsScreenShare) {
      throw new UnsupportedFeatureError(
        "enableScreenShare",
        "mediaManager",
        "Screen sharing is not supported by the current media manager",
      );
    }
    this.mediaManager.enableScreenShare(enable);
    this.sendSignallingMessage(
      new TrackStatusMessage(SCREEN_VIDEO_TRANSCEIVER_INDEX, enable),
    );
  }

  get isCamEnabled(): boolean {
    return this.mediaManager.isCamEnabled;
  }
  get isMicEnabled(): boolean {
    return this.mediaManager.isMicEnabled;
  }
  get isSharingScreen(): boolean {
    return this.mediaManager.isSharingScreen;
  }

  get state(): TransportState {
    return this._state;
  }

  set state(state: TransportState) {
    if (this._state === state) return;

    this._state = state;
    this._callbacks.onTransportStateChanged?.(state);
  }

  tracks(): Tracks {
    return this.mediaManager.tracks();
  }

  private sdpFilterCodec(kind: string, codec: string, realSdp: string): string {
    const allowed: number[] = [];
    const rtxRegex = new RegExp("a=fmtp:(\\d+) apt=(\\d+)\\r$");
    const codecRegex = new RegExp(
      "a=rtpmap:([0-9]+) " + this.escapeRegExp(codec),
    );
    const videoRegex = new RegExp("(m=" + kind + " .*?)( ([0-9]+))*\\s*$");

    const lines = realSdp.split("\n");

    let isKind = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("m=" + kind + " ")) {
        isKind = true;
      } else if (lines[i].startsWith("m=")) {
        isKind = false;
      }

      if (isKind) {
        const match = lines[i].match(codecRegex);
        if (match) {
          allowed.push(parseInt(match[1]));
        }

        const matchRtx = lines[i].match(rtxRegex);
        if (matchRtx && allowed.includes(parseInt(matchRtx[2]))) {
          allowed.push(parseInt(matchRtx[1]));
        }
      }
    }

    const skipRegex = "a=(fmtp|rtcp-fb|rtpmap):([0-9]+)";
    let sdp = "";

    isKind = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("m=" + kind + " ")) {
        isKind = true;
      } else if (lines[i].startsWith("m=")) {
        isKind = false;
      }

      if (isKind) {
        const skipMatch = lines[i].match(skipRegex);
        if (skipMatch && !allowed.includes(parseInt(skipMatch[2]))) {
          continue;
        } else if (lines[i].match(videoRegex)) {
          sdp += lines[i].replace(videoRegex, "$1 " + allowed.join(" ")) + "\n";
        } else {
          sdp += lines[i] + "\n";
        }
      } else {
        sdp += lines[i] + "\n";
      }
    }

    return sdp;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
