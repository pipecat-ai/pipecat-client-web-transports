/**
 * The network side of WebSocketTransport for the device contract suite: a
 * socket with a bot behind it that replies to client-ready with bot-ready,
 * and a pass-through serializer so messages stay readable. None of it
 * touches devices; local media comes from the media manager under test.
 */

import type { RTVIMessage } from "@pipecat-ai/client-js";
import type {
  DeserializedData,
  WebSocketSerializer,
} from "@pipecat-ai/websocket-transport";

export const WS_URL = "wss://example.test/ws";

type Frame = { kind: "message"; message: RTVIMessage } | { kind: "other" };

export const passThroughSerializer: WebSocketSerializer = {
  serialize: (): Frame => ({ kind: "other" }),
  serializeAudio: (): Frame => ({ kind: "other" }),
  serializeMessage: (message: RTVIMessage): Frame => ({
    kind: "message",
    message,
  }),
  deserialize: async (frame: Frame): Promise<DeserializedData> =>
    frame.kind === "message"
      ? { type: "message", message: frame.message }
      : { type: "raw", message: frame },
};

const socketControl = { failNext: false };

/** Make the next socket fail to open. */
export function failNextSocket(): void {
  socketControl.failNext = true;
}

/**
 * Stands in for the lib's ReconnectingWebSocket, so the transport's own
 * initializeWebsocket() wires its handlers onto it.
 */
class FakeReconnectingWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = 3;
  keepAliveInterval = 0;
  private _handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  constructor(
    public url: string,
    _protocols?: unknown,
    _options?: unknown
  ) {}

  on(event: string, handler: (...args: unknown[]) => void) {
    this._handlers.set(event, [...(this._handlers.get(event) ?? []), handler]);
    return this;
  }

  private _emit(event: string, ...args: unknown[]) {
    this._handlers.get(event)?.forEach((handler) => handler(...args));
  }

  async connect() {
    await new Promise((resolve) => setTimeout(resolve));
    if (socketControl.failNext) {
      socketControl.failNext = false;
      throw new Error("fake socket failed to open");
    }
    this.readyState = 1;
    this._emit("open");
  }

  async close() {
    this.readyState = 3;
  }

  async send(frame: Frame) {
    if (frame.kind !== "message" || frame.message.type !== "client-ready")
      return;
    setTimeout(() =>
      this._emit("message", {
        kind: "message",
        message: {
          label: "rtvi-ai",
          type: "bot-ready",
          id: "bot-ready-1",
          data: { version: "2.3.0" },
        },
      })
    );
  }
}

export const reconnectingWebSocketModule = {
  ReconnectingWebSocket: FakeReconnectingWebSocket,
};
