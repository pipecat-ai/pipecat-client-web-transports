import {
  logger,
  RTVIClientOptions,
  RTVIMessage,
  Tracks,
  Transport,
  TransportStartError,
  TransportState,
} from "@pipecat-ai/client-js";

import { ReconnectingWebSocket } from "../../../lib/websocket-utils/reconnectingWebSocket";
import { DailyMediaManager } from "../../../lib/media-mgmt/dailyMediaManager";

import { Frame } from "./generated/proto/frames";
import { MediaManager } from "../../../lib/media-mgmt/mediaManager";

export class WebSocketTransport extends Transport {
  declare private _ws: ReconnectingWebSocket | null;
  private static RECORDER_SAMPLE_RATE = 16_000;
  private audioQueue: ArrayBuffer[] = [];
  private _mediaManager: MediaManager;

  constructor() {
    super();
    this._mediaManager = new DailyMediaManager(
      true,
      true,
      undefined,
      undefined,
      512,
      WebSocketTransport.RECORDER_SAMPLE_RATE,
    );
    this._mediaManager.setUserAudioCallback(
      this.handleUserAudioStream.bind(this),
    );
    this._ws = null;
  }

  initialize(
    options: RTVIClientOptions,
    messageHandler: (ev: RTVIMessage) => void,
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._onMessage = messageHandler;
    this._mediaManager.setRTVIOptions(options);
    this.state = "disconnected";
  }

  async initDevices(): Promise<void> {
    this.state = "initializing";
    await this._mediaManager.initialize();
    this.state = "initialized";
  }

  async connect(
    authBundle: unknown,
    abortController: AbortController,
  ): Promise<void> {
    this.state = "connecting";
    try {
      this._ws = this.initializeWebsocket(authBundle);
      await this._ws.connect();
      await this._mediaManager.connect();
      this.state = "connected";
      this._callbacks.onConnected?.();
    } catch (error) {
      const msg = `Failed to connect to websocket: ${error}`;
      logger.error(msg);
      this.state = "error";
      throw new TransportStartError(msg);
    }
  }

  async disconnect(): Promise<void> {
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

  get expiry(): number | undefined {
    return this._expiry;
  }

  tracks(): Tracks {
    return this._mediaManager.tracks();
  }

  initializeWebsocket(authBundle: any): ReconnectingWebSocket {
    const ws = new ReconnectingWebSocket(`${authBundle.ws_url}`, undefined, {
      parseBlobToJson: false,
    });
    // disabling the keep alive, there is no API for it inside Pipecat
    ws.keepAliveInterval = 0;
    ws.on("open", () => {
      logger.debug("Websocket connection opened");
    });
    ws.on("message", async (data: Blob) => {
      let arrayBuffer: ArrayBuffer = await data.arrayBuffer();
      const parsedFrame = Frame.fromBinary(new Uint8Array(arrayBuffer)).frame;
      if (parsedFrame.oneofKind === "audio") {
        // We should be able to use parsedFrame.audio.audio.buffer but for
        // some reason that contains all the bytes from the protobuf message.
        const audioVector = Array.from(parsedFrame.audio.audio);
        const uint8Array = new Uint8Array(audioVector);
        const int16Array = new Int16Array(uint8Array.buffer);
        this._mediaManager.bufferBotAudio(int16Array);
      } else if (parsedFrame.oneofKind === "message") {
        let jsonText = parsedFrame.message.data;
        try {
          let jsonMessage = JSON.parse(jsonText);
          if (jsonMessage.label === "rtvi-ai") {
            this._onMessage(jsonMessage as RTVIMessage);
          }
        } catch {
          logger.warn("Failed to parse message", jsonText);
        }
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

  sendMessage(message: RTVIMessage): void {
    logger.debug("Received message to send to Web Socket", message);
    const frame = Frame.create({
      frame: {
        oneofKind: "message",
        message: {
          data: JSON.stringify(message),
        },
      },
    });
    void this._sendMsg(frame);
  }

  async _sendAudioInput(data: ArrayBuffer): Promise<void> {
    const pcmByteArray = new Uint8Array(data);
    const frame = Frame.create({
      frame: {
        oneofKind: "audio",
        audio: {
          id: 0n,
          name: "audio",
          audio: pcmByteArray,
          sampleRate: WebSocketTransport.RECORDER_SAMPLE_RATE,
          numChannels: 1,
        },
      },
    });
    await this._sendMsg(frame);
  }

  async _sendMsg(msg: Frame): Promise<void> {
    if (!this._ws) {
      logger.error("sendMsg called but WS is null");
      return;
    }
    if (this._ws.readyState !== WebSocket.OPEN) {
      logger.error("attempt to send to closed socket");
      return;
    }
    if (!msg) {
      logger.error("need a msg to send a msg");
      return;
    }
    try {
      const encodedFrame = new Uint8Array(Frame.toBinary(msg));
      await this._ws.send(encodedFrame);
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
