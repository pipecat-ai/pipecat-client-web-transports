import {
  BotTTSTextData,
  RTVIClientOptions,
  RTVIMessage,
  Tracks,
  TranscriptData,
  Transport,
  TransportState,
} from "@pipecat-ai/client-js";

import { MediaManager } from "../../../lib/media-mgmt/mediaManager";

export interface LLMServiceOptions {
  api_key: string;
  initial_messages?: Array<unknown>;
  model?: string;
  settings?: Record<string, unknown>;
}

/**
 * RealTimeWebsocketTransport is an abstract class that provides a client-side
 * interface for connecting to a real-time AI service. It is intended to
 * connect directly to the service. (No Pipecat server is involved.)
 */
export abstract class RealTimeWebsocketTransport extends Transport {
  // Utilities for audio.
  private _mediaManager;
  protected _service_options: LLMServiceOptions;

  protected _botIsSpeaking = false;

  constructor(service_options: LLMServiceOptions, manager: MediaManager) {
    super();
    this._service_options = service_options;
    this._mediaManager = manager;
    this._mediaManager.setUserAudioCallback(
      this.handleUserAudioStream.bind(this),
    );
  }

  /**
   * This method will be called from initialize()
   * Subclasses should initialize the LLM client and media player/recorder
   * and call initializeAudio() from within this method.
   */
  abstract initializeLLM(): void;
  /**
   * This method will be called from initialize()
   * Subclasses should etup listeners for LLM events from within this method
   */
  abstract attachLLMListeners(): void;
  /**
   * This method will be called from connect()
   * Subclasses should connect to the LLM and pass along the initial messages
   * @param initial_messages
   */
  abstract connectLLM(): Promise<void>;
  /**
   * This method will be called from disconnect()
   * Subclasses should disconnect from the LLM
   */
  abstract disconnectLLM(): Promise<void>;
  /**
   * This method will be called regularly with audio data from the user
   * Subclasses should handle this data and pass it along to the LLM
   * @param data ArrayBuffer of audio data
   */
  abstract handleUserAudioStream(data: ArrayBuffer): void;

  // subclasses should implement this method to initialize the LLM
  // client and call super() on this method
  initialize(
    options: RTVIClientOptions,
    messageHandler: (ev: RTVIMessage) => void,
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._onMessage = messageHandler;

    this._mediaManager.setRTVIOptions(options);

    this.initializeLLM();

    this.attachDeviceListeners();
    this.attachLLMListeners();

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

    await this.connectLLM();

    // connect user audio to llm
    this._mediaManager.connect();
    this.state = "connected";
    this._callbacks.onConnected?.();
  }

  async disconnect(): Promise<void> {
    this.state = "disconnecting";
    await this._mediaManager.disconnect();
    await this.disconnectLLM();
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
  get selectedCam(): MediaDeviceInfo | Record<string, never> {
    return this._mediaManager.selectedCam;
  }
  get selectedSpeaker(): MediaDeviceInfo | Record<string, never> {
    return this._mediaManager.selectedSpeaker;
  }

  enableMic(enable: boolean): void {
    this._mediaManager.enableMic(enable);
  }
  enableCam(enable: boolean): void {
    this._mediaManager.enableCam(enable);
  }

  get isCamEnabled(): boolean {
    return this._mediaManager.isCamEnabled;
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

  // Realtime event handlers
  async userStartedSpeaking(): Promise<unknown> {
    // Handle interruption
    const trackSampleOffset = await this._mediaManager.userStartedSpeaking();
    this._callbacks.onUserStartedSpeaking?.();
    return trackSampleOffset;
  }

  userStoppedSpeaking(): void {
    this._callbacks.onUserStoppedSpeaking?.();
  }

  userTranscript(transcript: TranscriptData): void {
    this._callbacks.onUserTranscript?.(transcript);
  }

  botStartedSpeaking(): void {
    if (!this._botIsSpeaking) {
      this._botIsSpeaking = true;
      this._callbacks.onBotStartedSpeaking?.();
    }
  }

  botStoppedSpeaking(): void {
    if (this._botIsSpeaking) {
      this._botIsSpeaking = false;
      this._callbacks.onBotStoppedSpeaking?.();
    }
  }

  botTtsText(data: BotTTSTextData): void {
    this._callbacks.onBotTtsText?.(data);
  }

  bufferBotAudio(audio: ArrayBuffer, id?: string): void {
    this._mediaManager.bufferBotAudio(audio, id);
  }

  connectionError(errorMsg: string): void {
    console.error(errorMsg);
    this.state = "error";
    this.disconnect();
  }

  private attachDeviceListeners(): void {}
}
