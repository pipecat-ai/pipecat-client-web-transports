import {
  Participant,
  RTVIActionRequestData,
  RTVIClientOptions,
  RTVIError,
  RTVIMessage,
  RTVIMessageType,
  Tracks,
  Transport,
  TransportStartError,
  TransportState,
} from "@pipecat-ai/client-js";

// here we use Daily just for input device management
import Daily, {
  DailyCall,
  DailyEventObjectAvailableDevicesUpdated,
  DailyEventObjectLocalAudioLevel,
  DailyEventObjectSelectedDevicesUpdated,
  DailyEventObjectTrack,
  DailyParticipant,
} from "@daily-co/daily-js";

const BASE_URL = "https://api.openai.com/v1/realtime";
const MODEL = "gpt-4o-realtime-preview-2024-12-17";

export interface OpenAIServiceOptions {
  api_key: string;
  model?: string;
  initial_messages?: Array<{ content: string; role: string }>;
  session_config?: {
    modailities?: string;
    instructions?: string;
    voice?:
      | "alloy"
      | "ash"
      | "ballad"
      | "coral"
      | "echo"
      | "sage"
      | "shimmer"
      | "verse";
    input_audio_transcription?: {
      model: "whisper-1";
    };
    temperature?: number;
    max_tokens?: number | "inf";
  };
}

export class OpenAIRealTimeWebRTCTransport extends Transport {
  private declare _service_options: OpenAIServiceOptions;

  private _openai_channel: RTCDataChannel | null = null;
  private _openai_cxn: RTCPeerConnection | null = null;
  private _senders: { [key: string]: RTCRtpSender } = {};
  private _botTracks: { [key: string]: MediaStreamTrack } = {};

  private declare _daily: DailyCall;

  private _selectedCam: MediaDeviceInfo | Record<string, never> = {};
  private _selectedMic: MediaDeviceInfo | Record<string, never> = {};
  private _selectedSpeaker: MediaDeviceInfo | Record<string, never> = {};

  private declare _botIsReadyResolve:
    | ((value: void | PromiseLike<void>) => void)
    | null;

  constructor(service_options: OpenAIServiceOptions) {
    super();
    this._service_options = service_options;
  }

  // subclasses should implement this method to initialize the LLM
  // client and call super() on this method
  initialize(
    options: RTVIClientOptions,
    messageHandler: (ev: RTVIMessage) => void
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._onMessage = messageHandler;

    this.state = "initializing";

    this._openai_cxn = new RTCPeerConnection();

    const existingInstance = Daily.getCallInstance();
    if (existingInstance) {
      this._daily = existingInstance;
    } else {
      this._daily = Daily.createCallObject({
        // Default is cam off
        startVideoOff: options.enableCam != true,
        // Default is mic on
        startAudioOff: options.enableMic == false,
      });
      this._attachDeviceListeners();
    }

    this._attachLLMListeners();

    this.state = "initialized";
  }

  async initDevices() {
    if (!this._daily) {
      throw new RTVIError("Transport instance not initialized");
    }

    const infos = await this._daily.startCamera({
      startVideoOff: true, // !(this._options.enableCam == true),
      startAudioOff: !(this._options.enableMic ?? true),
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
  }

  async connect(
    authBundle: unknown,
    abortController: AbortController
  ): Promise<void> {
    if (!this._openai_cxn) {
      console.error(
        "connectLLM called before the webrtc connection is initialized. Be sure to call initializeLLM() first."
      );
      return;
    }

    this.state = "connecting";

    await this._connectLLM();

    this.state = "connected";
    this._callbacks.onConnected?.();
  }

  async disconnect(): Promise<void> {
    this.state = "disconnecting";
    await this._disconnectLLM();
    this.state = "disconnected";
    this._callbacks.onDisconnected?.();
  }

  get state(): TransportState {
    return this._state;
  }

  private set state(state: TransportState) {
    if (this._state === state) return;

    this._state = state;
    this._callbacks.onTransportStateChanged?.(state);
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
  updateSpeaker(speakerId: string) {
    this._daily
      .setOutputDeviceAsync({ outputDeviceId: speakerId })
      .then((deviceInfo) => {
        this._selectedSpeaker = deviceInfo.speaker;
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

  enableMic(enable: boolean): void {
    if (!this._daily.participants()?.local) return;
    this._daily.setLocalAudio(enable);
  }
  enableCam(enable: boolean): void {
    if (!this._daily.participants()?.local) return;
    this._daily.setLocalVideo(enable);
  }

  get isCamEnabled(): boolean {
    return this._daily.localVideo();
  }
  get isMicEnabled(): boolean {
    return this._daily.localAudio();
  }

  tracks(): Tracks {
    const participants = this._daily?.participants() ?? {};

    const tracks: Tracks = {
      local: {
        audio: participants?.local?.tracks?.audio?.persistentTrack,
        video: participants?.local?.tracks?.video?.persistentTrack,
      },
    };
    if (Object.keys(this._botTracks).length > 0) {
      tracks.bot = this._botTracks;
    }
    return tracks;
  }

  async sendReadyMessage(): Promise<void> {
    const p = new Promise<void>((resolve) => {
      if (this.state === "ready") {
        resolve();
      } else {
        this._botIsReadyResolve = resolve;
      }
    });
    await p;
    this._onMessage({
      type: RTVIMessageType.BOT_READY,
      data: {},
    } as RTVIMessage);
  }

  sendMessage(message: RTVIMessage): void {
    if (message.type === "action") {
      const data = message.data as RTVIActionRequestData;
      if (data.action === "append_to_messages" && data.arguments) {
        for (const a of data.arguments) {
          if (a.name === "messages") {
            const value = a.value as Array<{ content: string; role: string }>;
            this._sendTextInput(value);
          }
        }
      }
    }
  }

  async _connectLLM(): Promise<void> {
    const audioSender = this._senders["audio"];
    if (!audioSender) {
      console.error("No audio sender found");
      let micTrack =
        this._daily.participants()?.local?.tracks?.audio?.persistentTrack;
      if (!micTrack) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          micTrack = stream.getAudioTracks()[0];
        } catch (e) {
          console.error(
            "Failed to get mic track. OpenAI requires audio on initial connection.",
            e
          );
          throw new RTVIError(
            "Failed to get mic track. OpenAI requires audio on initial connection."
          );
        }
      }
      this._senders["audio"] = this._openai_cxn!.addTrack(micTrack);
    }

    await this._negotiateConnection();
  }

  async _disconnectLLM(): Promise<void> {
    this._cleanup();
    // await this._daily.leave();
  }

  private _attachDeviceListeners(): void {
    this._daily.on("track-started", this._handleTrackStarted.bind(this));
    this._daily.on("track-stopped", this._handleTrackStopped.bind(this));
    this._daily.on(
      "available-devices-updated",
      this._handleAvailableDevicesUpdated.bind(this)
    );
    this._daily.on(
      "selected-devices-updated",
      this._handleSelectedDevicesUpdated.bind(this)
    );
    this._daily.on("local-audio-level", this._handleLocalAudioLevel.bind(this));
  }

  private _attachLLMListeners(): void {
    if (!this._openai_cxn) {
      console.error(
        "_attachLLMListeners called before the websocket is initialized. Be sure to call initializeLLM() first."
      );
      return;
    }
    this._openai_cxn.ontrack = (e) => {
      console.debug("[openai] got track from openai", e);
      this._botTracks[e.track.kind] = e.track;
      this._callbacks.onTrackStarted?.(e.track, botParticipant());
    };

    // Set up data channel for sending and receiving events
    if (this._openai_channel) {
      console.warn('closing existing data channel "oai-events"');
      this._openai_channel.close();
      this._openai_channel = null;
    }
    const dc = this._openai_cxn.createDataChannel("oai-events");
    dc.addEventListener("message", (e) => {
      const realtimeEvent = JSON.parse(e.data);
      this._handleOpenAIMessage(realtimeEvent);
    });
    this._openai_channel = dc;

    // client.on("conversation.item.completed", ({ item }) => {
    //   console.log("--> conversation item completed", item);
    // });

    // // Audio playout
    // client.on("conversation.updated", async ({ item, delta }: unknown) => {
    //   console.log("--> conversation updated", delta, item);
    //   if (delta?.audio) {
    //     console.log(" ----> buffering bot audio", delta.audio);
    //     this.bufferBotAudio(delta.audio, item.id);
    //   }
    // });

    this._openai_cxn.onconnectionstatechange = (e) => {
      const state = (e.target as RTCPeerConnection)?.connectionState;
      console.debug(`connection state changed to ${state.toUpperCase()}`);
      switch (state) {
        case "closed":
        case "failed":
          this._cleanup();
          break;
      }
    };
    this._openai_cxn.onicecandidateerror = (e) => {
      console.error("ice candidate error", e);
    };
    // client.on("error", (error: Error) => {
    //   console.error("error", error);
    //   // mrkb: shouldn't this get passed up?
    // });
  }

  async _negotiateConnection(): Promise<void> {
    const cxn = this._openai_cxn!;
    const service_options = this._service_options as OpenAIServiceOptions;
    const apiKey = service_options.api_key;
    if (!apiKey) {
      console.error("!!! No API key provided in service_options");
      return;
    }

    try {
      // Start the session using the Session Description Protocol (SDP)
      const offer = await cxn.createOffer();
      await cxn.setLocalDescription(offer);

      const model = service_options?.model ?? MODEL;

      const sdpResponse = await fetch(`${BASE_URL}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/sdp",
        },
      });

      const answer = {
        type: "answer" as RTCSdpType,
        sdp: await sdpResponse.text(),
      };
      await cxn.setRemoteDescription(answer);
    } catch (error) {
      const msg = `Failed to connect to LLM: ${error}`;
      console.error(msg);
      this.state = "error";
      throw new TransportStartError(msg);
    }
  }

  private _cleanup() {
    this._openai_channel?.close();
    this._openai_channel = null;
    this._openai_cxn?.close();
    this._openai_cxn = null;
    this._senders = {};
    this._botTracks = {};
  }

  private _updateSession() {
    const service_options = this._service_options as OpenAIServiceOptions;
    const session_config = service_options?.session_config ?? {};
    session_config.input_audio_transcription =
      session_config.input_audio_transcription ?? { model: "whisper-1" };
    console.log("updating session", session_config);
    this._openai_channel!.send(
      JSON.stringify({ type: "session.update", session: session_config })
    );
    if (service_options?.initial_messages) {
      this._sendTextInput(service_options.initial_messages);
    }
  }

  private async _handleOpenAIMessage(msg: Record<string, any>) {
    const type = msg.type;
    switch (type) {
      case "error":
        console.warn("openai error", msg);
        // todo: most openai errors are recoverable. For non-recoverable ones
        // we should throw an RTVIError and disconnect.
        break;
      case "session.created":
        this.state = "ready";
        if (this._botIsReadyResolve) {
          this._botIsReadyResolve();
          this._botIsReadyResolve = null;
        }
        this._updateSession();
        break;
      case "input_audio_buffer.speech_started":
        this._callbacks.onUserStartedSpeaking?.();
        break;
      case "input_audio_buffer.speech_stopped":
        this._callbacks.onUserStoppedSpeaking?.();
        break;
      case "conversation.item.input_audio_transcription.completed":
        // User transcripts usually arrive after the bot has started speaking again
        this._callbacks.onUserTranscript?.({
          text: msg.transcript,
          final: true,
          timestamp: Date.now().toString(), //time,
          user_id: "user",
        });
        break;
      case "response.content_part.added":
        if (msg?.part?.type === "audio") {
          this._callbacks.onBotStartedSpeaking?.();
        }
        break;
      case "response.audio.done":
        this._callbacks.onBotStoppedSpeaking?.();
        break;
      case "response.audio_transcript.delta":
        // There does not seem to be a way to align bot text output with audio. Text
        // streams faster than audio and all events, and all events are streamed at
        // LLM output speed.
        this._callbacks.onBotTtsText?.({ text: msg.delta });
        break;
      case "response.audio_transcript.done":
        this._callbacks.onBotTranscript?.({ text: msg.transcript });
        break;
      case "response.done":
        console.log("BOT DONE", msg);
        break;
      default:
        console.debug("ignoring openai message", msg);
    }
  }

  private async _handleTrackStarted(ev: DailyEventObjectTrack) {
    const sender = this._senders[ev.track.kind];
    if (sender) {
      if (sender.track?.id !== ev.track.id) {
        sender.replaceTrack(ev.track);
      }
    } else {
      this._senders[ev.track.kind] = this._openai_cxn!.addTrack(ev.track);
    }
    this._callbacks.onTrackStarted?.(
      ev.track,
      ev.participant ? dailyParticipantToParticipant(ev.participant) : undefined
    );
  }

  private async _handleTrackStopped(ev: DailyEventObjectTrack) {
    // TODO: Should sender track be replaced with null?
    this._callbacks.onTrackStopped?.(
      ev.track,
      ev.participant ? dailyParticipantToParticipant(ev.participant) : undefined
    );
  }

  private _handleAvailableDevicesUpdated(
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

  private _handleSelectedDevicesUpdated(
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

  private _handleLocalAudioLevel(ev: DailyEventObjectLocalAudioLevel) {
    this._callbacks.onLocalAudioLevel?.(ev.audioLevel);
  }

  private _sendTextInput(messages: Array<{ content: string; role: string }>) {
    if (!this._openai_channel) return;
    messages.forEach((m) => {
      const event = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: m.role,
          content: [{ type: "input_text", text: m.content }],
        },
      };
      this._openai_channel!.send(JSON.stringify(event));
    });
    this._openai_channel.send(JSON.stringify({ type: "response.create" }));
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
