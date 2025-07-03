import {
  logger,
  PipecatClientOptions,
  RTVIError,
  RTVIMessage,
  Tracks,
  Transport,
  TransportStartError,
  TransportState,
  UnsupportedFeatureError,
} from "@pipecat-ai/client-js";

import { ReconnectingWebSocket } from "../../../lib/websocket-utils/reconnectingWebSocket";
import { DailyMediaManager } from "../../../lib/media-mgmt/dailyMediaManager";
import { MediaManager } from "../../../lib/media-mgmt/mediaManager";
import { WebSocketSerializer } from "./serializers/websocketSerializer.ts";
import { ProtobufFrameSerializer } from "./serializers/protobufSerializer.ts";

export type WebSocketTransportOptions = {
  ws_url?: string; // TODO: make connectionUrl to match smallwebrtc options?
  serializer?: WebSocketSerializer;
  recorderSampleRate?: number;
  playerSampleRate?: number;
};

export class WebSocketTransport extends Transport {
  declare private _ws: ReconnectingWebSocket | null;
  private _wsUrl: string | null = null;
  private static RECORDER_SAMPLE_RATE = 16_000;
  private static PLAYER_SAMPLE_RATE = 24_000;
  private audioQueue: ArrayBuffer[] = [];
  private _mediaManager: MediaManager;
  private _serializer: WebSocketSerializer;
  private _recorderSampleRate: number;

  constructor(opts: WebSocketTransportOptions = {}) {
    super();
    this._wsUrl = opts.ws_url || null;
    this._recorderSampleRate =
      opts.recorderSampleRate || WebSocketTransport.RECORDER_SAMPLE_RATE;
    this._mediaManager = new DailyMediaManager(
      true,
      true,
      undefined,
      undefined,
      512,
      this._recorderSampleRate,
      opts.playerSampleRate || WebSocketTransport.PLAYER_SAMPLE_RATE,
    );
    this._mediaManager.setUserAudioCallback(
      this.handleUserAudioStream.bind(this),
    );
    this._ws = null;
    this._serializer = opts.serializer || new ProtobufFrameSerializer();
  }

  initialize(
    options: PipecatClientOptions,
    messageHandler: (ev: RTVIMessage) => void,
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._onMessage = messageHandler;
    this._mediaManager.setClientOptions(options);
    this.state = "disconnected";
  }

  async initDevices(): Promise<void> {
    this.state = "initializing";
    await this._mediaManager.initialize();
    this.state = "initialized";
  }

  _validateConnectionParams(
    connectParams: unknown,
  ): WebSocketTransportOptions | undefined {
    if (connectParams === undefined || connectParams === null) {
      return undefined;
    }
    if (typeof connectParams !== "object") {
      throw new RTVIError("Invalid connection parameters");
    }
    for (const [key, val] of Object.entries(connectParams)) {
      if (key !== "connectionUrl") {
        throw new RTVIError(
          `Unrecognized connection parameter: ${key}. Only 'connectionUrl' is allowed.`,
        );
      } else if (typeof val !== "string") {
        throw new RTVIError(
          `Invalid type for connectionUrl: expected string, got ${typeof val}`,
        );
      }
    }
    return connectParams as WebSocketTransportOptions;
  }

  async _connect(connectParams?: WebSocketTransportOptions): Promise<void> {
    if (this._abortController?.signal.aborted) return;

    this.state = "connecting";

    this._wsUrl = connectParams?.ws_url || this._wsUrl;
    if (!this._wsUrl) {
      logger.error("No url provided for connection");
      this.state = "error";
      throw new TransportStartError();
    }
    try {
      this._ws = this.initializeWebsocket();

      await this._ws.connect();
      await this._mediaManager.connect();

      if (this._abortController?.signal.aborted) return;

      this.state = "connected";
      this._callbacks.onConnected?.();
    } catch (error) {
      const msg = `Failed to connect to websocket: ${error}`;
      logger.error(msg);
      this.state = "error";
      throw new TransportStartError(msg);
    }
  }

  async _disconnect(): Promise<void> {
    this.state = "disconnecting";
    await this._mediaManager.disconnect();
    await this._ws?.close();
    this.state = "disconnected";
    this._callbacks.onDisconnected?.();
  }

  getAllMics(): Promise<MediaDeviceInfo[]> {
    return this._mediaManager.getAllMics();
  }
  getAllCams(): Promise<MediaDeviceInfo[]> {
    return this._mediaManager.getAllCams();
  }
  getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    return this._mediaManager.getAllSpeakers();
  }

  async updateMic(micId: string): Promise<void> {
    return this._mediaManager.updateMic(micId);
  }
  updateCam(camId: string): void {
    return this._mediaManager.updateCam(camId);
  }
  updateSpeaker(speakerId: string): void {
    return this._mediaManager.updateSpeaker(speakerId);
  }

  get selectedMic(): MediaDeviceInfo | Record<string, never> {
    return this._mediaManager.selectedMic;
  }
  get selectedSpeaker(): MediaDeviceInfo | Record<string, never> {
    return this._mediaManager.selectedSpeaker;
  }

  enableMic(enable: boolean): void {
    this._mediaManager.enableMic(enable);
  }
  get isMicEnabled(): boolean {
    return this._mediaManager.isMicEnabled;
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
    return this._mediaManager.tracks();
  }

  initializeWebsocket(): ReconnectingWebSocket {
    const ws = new ReconnectingWebSocket(this._wsUrl!, undefined, {
      parseBlobToJson: false,
    });
    // disabling the keep alive, there is no API for it inside Pipecat
    ws.keepAliveInterval = 0;
    ws.on("open", () => {
      logger.debug("Websocket connection opened");
    });
    ws.on("message", async (data: any) => {
      try {
        const parsed = await this._serializer.deserialize(data);
        if (parsed.type === "audio") {
          this._mediaManager.bufferBotAudio(parsed.audio);
        } else if (parsed.type === "message") {
          if (parsed.message.label === "rtvi-ai") {
            this._onMessage(parsed.message);
          }
        }
      } catch (e) {
        logger.error("Failed to deserialize incoming message", e);
      }
    });
    ws.on("error", (error: Error) => {
      this.connectionError(`websocket error: ${error}`);
    });
    ws.on("connection-timeout", () => {
      this.connectionError("websocket connection timed out");
    });
    ws.on("close", (code: number) => {
      this.connectionError(`websocket connection closed. Code: ${code}`);
    });
    ws.on("reconnect-failed", () => {
      this.connectionError(`websocket reconnect failed`);
    });
    return ws;
  }

  sendReadyMessage(): void {
    this.state = "ready";
    this.sendMessage(RTVIMessage.clientReady());
  }

  handleUserAudioStream(data: ArrayBuffer): void {
    if (this.state === "ready") {
      try {
        void this.flushAudioQueue();
        void this._sendAudioInput(data);
      } catch (error) {
        logger.error("Error sending audio stream to websocket:", error);
        this.state = "error";
      }
    } else {
      this.audioQueue.push(data);
    }
  }

  private flushAudioQueue(): void {
    if (this.audioQueue.length <= 0) {
      return;
    }
    logger.info("Will flush audio queue", this.audioQueue.length);
    while (this.audioQueue.length > 0) {
      const queuedData = this.audioQueue.shift();
      if (queuedData) void this._sendAudioInput(queuedData);
    }
  }

  sendRawMessage(message: any): void {
    const encoded = this._serializer.serialize(message);
    void this._sendMsg(encoded);
  }

  sendMessage(message: RTVIMessage): void {
    const encoded = this._serializer.serializeMessage(message);
    void this._sendMsg(encoded);
  }

  async _sendAudioInput(data: ArrayBuffer): Promise<void> {
    try {
      const encoded = this._serializer.serializeAudio(
        data,
        this._recorderSampleRate,
        1,
      );
      await this._sendMsg(encoded);
    } catch (e) {
      logger.error("Error sending audio frame", e);
    }
  }

  async _sendMsg(msg: any): Promise<void> {
    if (!this._ws) {
      logger.error("sendMsg called but WS is null");
      return;
    }
    if (this._ws.readyState !== WebSocket.OPEN) {
      logger.error("attempt to send to closed socket");
      return;
    }
    if (!msg) {
      return;
    }
    try {
      await this._ws.send(msg);
    } catch (e) {
      logger.error("sendMsg error", e);
    }
  }

  connectionError(errorMsg: string): void {
    console.error(errorMsg);
    this.state = "error";
    void this.disconnect();
  }

  // Not implemented
  enableScreenShare(enable: boolean): void {
    logger.error("startScreenShare not implemented for WebSocketTransport");
    throw new UnsupportedFeatureError(
      "Screen sharing",
      "webSocketTransport",
      "This feature has not been implemented",
    );
    throw new Error("Not implemented");
  }

  public get isSharingScreen(): boolean {
    logger.error("isSharingScreen not implemented for WebSocketTransport");
    return false;
  }

  enableCam(enable: boolean) {
    logger.error("enableCam not implemented for WebSocketTransport");
    throw new Error("Not implemented");
  }

  get isCamEnabled(): boolean {
    logger.error("isCamEnabled not implemented for WebSocketTransport");
    return false;
  }

  get selectedCam(): MediaDeviceInfo | Record<string, never> {
    logger.error("selectedCam not implemented for WebSocketTransport");
    throw new Error("Not implemented");
  }
}
