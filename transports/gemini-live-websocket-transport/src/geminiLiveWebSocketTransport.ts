import {
  DailyMediaManager,
  MediaManager,
  RealTimeWebsocketTransport,
  LLMServiceOptions,
} from "@pipecat-ai/realtime-websocket-transport";

import { ReconnectingWebSocket } from "../../../lib/websocket-utils/reconnectingWebSocket.js";
import {
  RTVIMessage,
  RTVIMessageType,
  TransportStartError,
} from "@pipecat-ai/client-js";

const HOST = `preprod-generativelanguage.googleapis.com`;
// const HOST = `generativelanguage.googleapis.com`;
const BIDI_PATH = `google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;
// const MODEL = "models/gemini-2.0-flash-exp-bidi-alt";
const MODEL = "models/gemini-2.0-flash-exp";

export interface GeminiLLMServiceOptions extends LLMServiceOptions {
  initial_messages?: Array<{ content: string; role: string }>;
  api_key: string;
  generation_config?: {
    candidate_count?: number;
    maxOutput_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    response_modalities?: string;
    speech_config?: {
      voice_config?: {
        prebuilt_voice_config?: {
          voice_name: "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede";
          // | "Voice O";
        };
      };
    };
  };
}

export class GeminiLiveWebsocketTransport extends RealTimeWebsocketTransport {
  private declare _ws: ReconnectingWebSocket | null;
  private declare _botResponseID: number;
  private declare _botIsReadyResolve:
    | ((value: void | PromiseLike<void>) => void)
    | null;

  constructor(
    service_options: GeminiLLMServiceOptions,
    manager?: MediaManager
  ) {
    if (!manager) {
      manager = new DailyMediaManager();
    }
    super(service_options, manager);

    this._ws = null;

    this._botResponseID = 0;
  }

  initializeLLM(): void {
    const service_options = this._service_options as GeminiLLMServiceOptions;
    const apiKey = service_options.api_key;
    if (!apiKey) {
      console.error("!!! No API key provided in llm_service_optsion");
      return;
    }
    const base_url = `wss://${HOST}/ws/${BIDI_PATH}`;
    this._ws = new ReconnectingWebSocket(`${base_url}?key=${apiKey}`);
    // don't run the keep alive interval until we determine if there's an api for it
    this._ws.keepAliveInterval = 0;
  }

  // This is called from super.initialize()
  attachLLMListeners(): void {
    if (!this._ws) {
      console.error(
        "attachLLMListeners called before the websocket is initialized. Be sure to call initializeLLM() first."
      );
      return;
    }
    this._ws.on("open", () => {});
    this._ws.on("message", async (msg: any) => {
      const content = msg.serverContent;
      if (!content) {
        if ("setupComplete" in msg) {
          this.state = "ready";
          if (this._botIsReadyResolve) {
            this._botIsReadyResolve();
            this._botIsReadyResolve = null;
          }
        } else {
          console.log("received unknown message", msg);
        }
        return;
      }
      if (content.modelTurn) {
        let result: ArrayBuffer | null = null;
        content.modelTurn.parts?.forEach((part: { inlineData: any }) => {
          if (part.inlineData?.data) {
            if (result) {
              mergeBuffers(result, base64ToArrayBuffer(part.inlineData.data));
            } else {
              result = base64ToArrayBuffer(part.inlineData.data);
            }
          }
        });
        if (result) {
          if (!this._botIsSpeaking) {
            this._botResponseID++;
            this.botStartedSpeaking();
          }
          this.bufferBotAudio(result, this._botResponseID.toString());
        }
      } else if (content.interrupted) {
        await this.userStartedSpeaking();
      } else if (content.turnComplete) {
        this.botStoppedSpeaking();
      } else {
        // console.log('unhandled message', content);
      }
    });
    this._ws.on("error", (error: Error) => {
      this.connectionError(`websocket error: ${error}`);
    });
    this._ws.on("connection-timeout", () => {
      this.connectionError("websocket connection timed out");
    });
    this._ws.on("close", (code: number) => {
      this.connectionError(`websocket connection closed. Code: ${code}`);
    });
    this._ws.on("reconnect-failed", () => {
      this.connectionError(`websocket reconnect failed`);
    });
  }

  async connectLLM(): Promise<void> {
    if (!this._ws) {
      console.error(
        "connectLLM called before the websocket is initialized. Be sure to call initializeLLM() first."
      );
      return;
    }
    try {
      await this._ws.connect();
    } catch (error) {
      const msg = `Failed to connect to LLM: ${error}`;
      console.error(msg);
      this.state = "error";
      throw new TransportStartError(msg);
    }

    const service_options = this._service_options as GeminiLLMServiceOptions;
    const model = service_options?.model ?? MODEL;
    const generation_config = service_options?.generation_config ?? {};
    let config = { setup: { model, generation_config } };
    await this._sendMsg(config);

    // For this bare-bones prototype, let's just see if we have any initial_messages in the params
    // we were constructed with.
    if (service_options?.initial_messages) {
      service_options.initial_messages.forEach(
        (msg: { content: string; role: string }) => {
          this._sendTextInput(msg.content, msg.role);
        }
      );
    }
  }

  async disconnectLLM(): Promise<void> {
    await this._ws?.close();
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

  handleUserAudioStream(data: ArrayBuffer): void {
    if (this.state === "ready") {
      try {
        void this._sendAudioInput(data);
      } catch (error) {
        console.error("Error adding audio to stream player", error);
        this.state = "error";
        // todo: should check this error more carefully, implement disconnect, implement
        // ping/ack connection monitoring and reconnection logic, etc.
      }
    }
  }

  sendMessage(message: RTVIMessage): void {
    if (message?.type === "send-text") {
      this._sendTextInput(message.data as string, "user");
    }
  }

  async _sendAudioInput(data: ArrayBuffer): Promise<void> {
    // TODO: pull this number from the media manager
    const sampleRate = 24000;
    const msg = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: `audio/pcm;rate=${sampleRate}`,
            data: arrayBufferToBase64(data),
          },
        ],
      },
    };
    await this._sendMsg(msg);
  }

  async _sendTextInput(text: string, role: string): Promise<void> {
    const msg = {
      clientContent: {
        turns: [
          {
            role,
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };
    await this._sendMsg(msg);
  }

  async _sendMsg(msg: unknown): Promise<void> {
    if (!this._ws) {
      console.error("sendMsg called but WS is null");
      return;
    }
    if (this._ws.readyState !== WebSocket.OPEN) {
      console.error("attempt to send to closed socket");
      return;
    }
    if (!msg) {
      console.error("need a msg to send a msg");
      return;
    }
    try {
      await this._ws.send(JSON.stringify(msg));
    } catch (e) {
      console.error("sendMsg error", e);
    }
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function mergeBuffers(
  leftBuffer: ArrayBuffer,
  rightBuffer: ArrayBuffer
): ArrayBuffer {
  const tmpArray = new Uint8Array(
    leftBuffer.byteLength + rightBuffer.byteLength
  );
  tmpArray.set(new Uint8Array(leftBuffer), 0);
  tmpArray.set(new Uint8Array(rightBuffer), leftBuffer.byteLength);
  return tmpArray.buffer;
}
