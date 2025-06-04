import { EventEmitter } from "events";

const readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
const KEEP_ALIVE_INTERVAL = 5000;
const KEEP_ALIVE_TIMEOUT = 15000;
// client side code in soupSFU has a timeout of 15 seconds for command response
// 5 seconds seems reasonable that it provides roughly 3 retry attempts
const WEBSOCKET_CONNECTION_TIMEOUT = 150 * 1000;
const DEFAULT_RECONNECT_ATTEMPTS = 2;
const MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_RECONNECT_INTERVAL = 1000;
const MAX_RECONNECT_INTERVAL = 30 * 1000;
const DEFAULT_RECONNECT_DECAY = 1.5;

const WEBSOCKET_TIMEOUT_CODE = 4100;

const SIG_CONNECTION_CANCELED = "SIG_CONNECTION_CANCELED";
const WEBSOCKET_ERROR = "WEBSOCKET_ERROR";

enum LOG_LEVEL {
  DEBUG,
  ERROR,
  INFO,
  WARN,
}

class rWebSocket {
  private _ws: WebSocket;
  _closedManually: boolean = false;
  _errored: boolean = false;
  _rejected: boolean = false;
  _timed_out: boolean = false;
  _initialConnectionOk: string | boolean = false;

  constructor(url: string, protocols?: string | string[]) {
    this._ws = new WebSocket(url, protocols);
  }

  addEventListener(
    type: string,
    listener: (this: WebSocket, ev: Event) => any,
  ) {
    this._ws.addEventListener(type, listener);
  }

  // Add other WebSocket methods as needed
  close(code?: number, reason?: string) {
    this._ws.close(code, reason);
  }

  send(data: string | ArrayBuffer | Blob | ArrayBufferView) {
    this._ws.send(data);
  }

  // Add getters for WebSocket properties
  get url() {
    return this._ws.url;
  }

  get readyState() {
    return this._ws.readyState;
  }
}

interface WebSocketOptions {
  parseBlobToJson?: boolean;
}

/**
 * Builds on top of Javascript Websockets
 *
 * This behaves like the Websocket library in every way, except if it fails to
 * connect or if it gets disconnected, it will try to reconnect depending on
 * the maximum number of reconnect attempts set. retry is not enabled for initial
 * connection. When initial connection fails it is best to check yourself before
 * you keep wreckin' yourself.
 *
 * It is API compatible, so when you have:
 *   ws = new WebSocket('ws://....');
 * you can replace with:
 *   ws = new ReconnectingWebSocket('ws://....');
 *
 * While it is API compatible with the NodeJS ws library, we provide the
 * following additional properties and events on the ReconnectingWebSocket.
 *
 * Events:
 *
 * connection-timeout
 * - Emitted when the web socket connection times out.
 *
 * reconnecting
 * - Emitted after a manual close of the web socket is done and before retrying
 *   the connection.
 *
 * reconnect-failed
 * - Emitted when the number of connection attempts exceeds the set number of
 *   reconnection attempts.
 *
 * keep-alive
 * - Emitted when the set keep alive interval elapses. This event may be used
 *   to have ping pong keep-alive mechanism for web socket health.
 *
 * Properties:
 *
 * keepAliveTimeout
 * - The timeout for keep-alive. Default: 15000
 *
 * keepAliveInterval
 * - The interval at which to emit keep-alive event. Default: 5000
 *
 * shouldRetryFn
 * - A callback function which should return boolean to determine if a web
 *   socket reconnection attempt should be made. When not set, connection is
 *   always retried.
 *
 * connectionTimeout
 * - The timeout interval for considering whether the connection timed out.
 *   Default: 20000 ms
 *
 * maxReconnectAttempts
 * - The maximum number of attempts to be made for reconnection. Default: 2
 *
 * reconnectInterval
 * - The interval to wait before attempting a reconnection. Default: 1000 ms
 */
export class ReconnectingWebSocket extends EventEmitter {
  /** The connection is not yet open. */
  static readonly CONNECTING: 0;
  /** The connection is open and ready to communicate. */
  static readonly OPEN: 1;
  /** The connection is in the process of closing. */
  static readonly CLOSING: 2;
  /** The connection is closed. */
  static readonly CLOSED: 3;

  private _ws: rWebSocket | null;

  _url: string;
  _protocols: string | string[] | undefined;

  declare private _keepAliveTimeout: number;
  declare private _keepAliveInterval: number;
  declare private _lastMsgRecvTime: number;
  declare private _lastMsgSendTime: number;
  declare private _disconnected: boolean;
  declare private _keepIntervalID: ReturnType<typeof setTimeout> | null;
  declare private _connectionTimeout: number;
  declare private _connectionTimeoutID:
    | ReturnType<typeof setTimeout>
    | undefined;
  declare private _reconnectTimeoutID:
    | ReturnType<typeof setTimeout>
    | undefined;
  declare private _shouldRetryFn: (() => boolean) | null;
  declare private _reconnectAttempts: number;
  declare private _allowedReconnectAttempts: number;
  declare private _reconnectInterval: number;
  declare private _maxReconnectInterval: number;
  declare private _reconnectDecay: number;
  declare private _parseBlobToJson: boolean;

  constructor(
    address: string,
    protocols?: string | string[],
    options: WebSocketOptions = {},
  ) {
    super();

    if (!address) {
      throw new Error("Need a valid WebSocket URL");
    }

    this._ws = null;

    this._url = address;
    this._protocols = protocols;
    this._parseBlobToJson = options?.parseBlobToJson ?? true;

    this.init();
  }

  private init() {
    this._keepAliveTimeout = KEEP_ALIVE_TIMEOUT;
    this._keepAliveInterval = KEEP_ALIVE_INTERVAL;
    this._disconnected = false;
    this._keepIntervalID = null;
    this._shouldRetryFn = null;
    this._connectionTimeout = WEBSOCKET_CONNECTION_TIMEOUT;
    this._reconnectAttempts = 0;
    this._allowedReconnectAttempts = DEFAULT_RECONNECT_ATTEMPTS;
    this._reconnectInterval = DEFAULT_RECONNECT_INTERVAL;
    this._maxReconnectInterval = MAX_RECONNECT_INTERVAL;
    this._reconnectDecay = DEFAULT_RECONNECT_DECAY;
  }

  public async connect() {
    return new Promise((resolve, reject) => {
      this._disconnected = false;
      this.clearReconnectTimeout();

      let ws: rWebSocket = new rWebSocket(this._url, this._protocols);
      this.setConnectionTimeout();

      ws.addEventListener("close", (evt) => {
        const closeEvent = evt as CloseEvent;
        let code = ws._timed_out ? WEBSOCKET_TIMEOUT_CODE : closeEvent.code;
        let reason = ws._timed_out
          ? "websocket connection timed out"
          : closeEvent.reason;
        ws._timed_out = false;
        if (!ws._closedManually && ws._initialConnectionOk) {
          console.warn(
            `signaling socket closed unexpectedly: ${code}${
              reason ? " " + reason : ""
            }`,
          );
          this._closeSocket();
          this.emit("close", code, reason);
        } else {
          this.log("signaling socket closed");
        }
        if (!ws._closedManually && (ws._errored || ws._timed_out)) {
          console.warn(
            `signaling socket closed on error: ${code}${
              reason ? " " + reason : ""
            }`,
          );
          if (!ws._rejected) {
            ws._rejected = true;
            const err = new Error(
              `WebSocket connection error (${code}): ${reason}`,
            );
            err.name = WEBSOCKET_ERROR;
            reject(err);
          }
        }
      });
      ws.addEventListener("open", (evt) => {
        this.log("wss connection opened to", LOG_LEVEL.DEBUG, this._url);
        this.clearConnectionTimeout();
        // now that the timeout closes the socket, in theory this onopen
        // callback should never happen in the first place, but seems
        // harmless to leave these safeguards in
        if (ws._rejected || ws._timed_out) {
          return;
        }
        if (ws._closedManually || (this._ws && this._ws !== ws)) {
          ws._rejected = true;
          ws.close();
          let err = Error(
            "wss connection interrupted by disconnect or newer connection",
          );
          err.name = SIG_CONNECTION_CANCELED;
          reject(err);
          return;
        }
        ws._initialConnectionOk = this._url;
        this._lastMsgRecvTime = Date.now();
        if (this._keepAliveInterval) {
          this._keepIntervalID = setInterval(
            () => this.checkSocketHealthAndSendKeepAlive(),
            this._keepAliveInterval,
          );
        }
        this._ws = ws;
        this.emit("open");
        resolve(ws);
      });
      ws.addEventListener("error", (evt) => {
        // fyi: evt is an Event here, with 0 amount of helpful info. If there
        //   happens to be info about the error, it's included in the
        //   accompanying close event (because that make sense. shakes head)
        //   SO. We do not reject here. Instead, we just set the _errored
        //   flag on the socket so when the close event occurs, it knows to
        //   reject the promise
        if (!ws._closedManually) {
          const wsTarget = evt.currentTarget as WebSocket;
          this.log(`websocket error event: ${wsTarget?.url}`);
        }
        ws._errored = true;
      });
      ws.addEventListener("message", (msg) => {
        void this._handleMessage(msg as MessageEvent);
      });
    });
  }

  private setConnectionTimeout() {
    this._connectionTimeoutID = setTimeout(async () => {
      this.log("Connection reconnect attempt timed out.");
      this.emit("connection-timeout");
      this.clearConnectionTimeout();
      await this._closeSocket();
    }, this._connectionTimeout);
  }

  private clearConnectionTimeout() {
    clearTimeout(this._connectionTimeoutID);
    this._connectionTimeoutID = undefined;
  }

  private clearReconnectTimeout() {
    clearTimeout(this._reconnectTimeoutID);
    this._reconnectTimeoutID = undefined;
  }

  private clearKeepAliveInterval() {
    if (this._keepIntervalID) {
      clearInterval(this._keepIntervalID);
      this._keepIntervalID = null;
    }
  }

  private async checkSocketHealthAndSendKeepAlive() {
    if (!(this._ws && this._ws.readyState === WebSocket.OPEN)) {
      return;
    }

    if (!this._keepAliveTimeout || !this._keepAliveInterval) {
      return;
    }

    // See if we haven't gotten a message back recently, and if we
    // haven't, close the socket. the os timeouts to detect if a socket
    // has gone stale are longer than we want.
    if (Date.now() - this._lastMsgRecvTime > this._keepAliveTimeout) {
      this.log("Connection is stale, need to reconnect", LOG_LEVEL.WARN);
      await this._closeSocket();
      return;
    }

    // Only emit the keep-alive event if we haven't sent anything else recently
    if (Date.now() - this._lastMsgSendTime < this._keepAliveInterval) {
      return;
    }

    this.log("Emitting keep-alive", LOG_LEVEL.DEBUG);
    this.emit("keep-alive");
  }

  // We use the word manually here to imply the application using this code
  // or this code itself will decide to close the socket.
  private async _closeSocket() {
    this.log("Closing");
    try {
      this.clearKeepAliveInterval();
      this._lastMsgRecvTime = 0;

      if (this._ws) {
        this._ws._closedManually = true;
        this._ws.close();
      }

      // query retry function if we want to retry.
      const shouldRetry =
        this._ws?._initialConnectionOk &&
        this._shouldRetryFn &&
        this._shouldRetryFn();

      this._ws = null;

      if (shouldRetry) {
        this.log("Emitting reconnect", LOG_LEVEL.DEBUG);
        this.emit("reconnecting");
        await this.retryFailedConnection();
      }
    } catch (error) {
      this.log(`Error while closing and retrying: ${error}`, LOG_LEVEL.ERROR);
    }
  }

  private async retryFailedConnection() {
    if (this._reconnectAttempts < this._allowedReconnectAttempts) {
      if (this._reconnectTimeoutID) {
        this.log("Retry already scheduled");
        return;
      }
      this.log("Retrying failed connection");
      let timeout =
        // The timeout logic is taken from
        // https://github.com/joewalnes/reconnecting-websocket
        this._reconnectInterval *
        Math.pow(this._reconnectDecay, this._reconnectAttempts);
      timeout =
        timeout > this._maxReconnectInterval
          ? this._maxReconnectInterval
          : timeout;
      this.log(`Reconnecting in ${timeout / 1000} seconds`);

      this._reconnectAttempts += 1;
      this._reconnectTimeoutID = setTimeout(() => this.connect(), timeout);
    } else {
      this.log("Maximum connection retry attempts exceeded", LOG_LEVEL.ERROR);
      this.emit("reconnect-failed");
    }
  }

  private log(
    msg: string,
    log_level: LOG_LEVEL = LOG_LEVEL.DEBUG,
    ...args: any
  ) {
    switch (log_level) {
      case LOG_LEVEL.DEBUG:
        console.debug(`websocket: ${msg}`, ...args);
        break;
      case LOG_LEVEL.ERROR:
        console.error(`websocket: ${msg}`, ...args);
        break;
      case LOG_LEVEL.WARN:
        console.warn(`websocket: ${msg}`, ...args);
        break;
      case LOG_LEVEL.INFO:
      default:
        console.log(`websocket: ${msg}`, ...args);
        break;
    }
  }

  async send(data: any) {
    try {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._lastMsgSendTime = Date.now();
        this._ws.send(data);
      } else {
        this.log(`Failed to send data, web socket not open.`, LOG_LEVEL.ERROR);
      }
    } catch (error) {
      this.log(`Failed to send data. ${error}`, LOG_LEVEL.ERROR);
    }
  }

  async close() {
    try {
      this.log("Closing websocket");
      this._disconnected = true;
      this.clearReconnectTimeout();
      this._closeSocket();
    } catch (error) {
      this.log(`Failed to close websocket. ${error}`);
    }
  }

  get readyState(): number {
    return this._ws?.readyState ?? WebSocket.CLOSED;
  }

  get url(): string {
    return this._url;
  }

  get keepAliveTimeout(): number {
    return this._keepAliveTimeout;
  }

  set keepAliveTimeout(keepAliveTimeout: number) {
    if (typeof keepAliveTimeout === "number") {
      this.log(`Setting ACK freshness timeout to ${keepAliveTimeout}`);
      this._keepAliveTimeout = keepAliveTimeout;
    }
  }

  get keepAliveInterval(): number {
    return this._keepAliveInterval;
  }

  set keepAliveInterval(keepAliveInterval: number) {
    if (typeof keepAliveInterval === "number") {
      this.log(`Setting keep-alive interval to ${keepAliveInterval}`);
      this._keepAliveInterval = keepAliveInterval;
    }
  }

  set shouldRetryFn(cb: () => boolean) {
    if (typeof cb === "function") {
      this._shouldRetryFn = cb;
    }
  }

  get connectionTimeout(): number {
    return this._connectionTimeout;
  }

  set connectionTimeout(timeout: number) {
    if (typeof timeout === "number") {
      this._connectionTimeout = timeout;
    }
  }

  get maxReconnectAttempts(): number {
    return this._allowedReconnectAttempts;
  }

  set maxReconnectAttempts(attempts: number) {
    if (attempts > 0 && attempts < MAX_RECONNECT_ATTEMPTS) {
      this.log(`Setting maximum connection retry attempts to ${attempts}`);
      this._allowedReconnectAttempts = attempts;
    } else {
      this._allowedReconnectAttempts = DEFAULT_RECONNECT_ATTEMPTS;
    }
  }

  get reconnectInterval(): number {
    return this._reconnectInterval;
  }

  set reconnectInterval(interval: number) {
    if (typeof interval === "number") {
      this._reconnectInterval =
        interval < this._maxReconnectInterval
          ? interval
          : this._maxReconnectInterval;
    }
  }

  async _handleMessage(event: MessageEvent) {
    this._lastMsgRecvTime = Date.now();
    const data = event.data;

    const _parsePromise = new Promise((resolve, reject) => {
      if (typeof data === "string") {
        // Handle text message
        resolve(data);
      } else if (data instanceof ArrayBuffer) {
        // Handle binary message
        const arrayBuffer = data;
        // Parse the ArrayBuffer as needed
        // Example: Convert ArrayBuffer to Uint8Array
        resolve(new Uint8Array(arrayBuffer));
        // Process the Uint8Array as needed
      } else if (data instanceof Blob) {
        if (!this._parseBlobToJson) {
          resolve(data);
          return;
        }
        // Handle Blob message
        const blob = data;
        // Convert Blob to ArrayBuffer
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          try {
            const json = JSON.parse(text);
            resolve(json);
          } catch (e) {
            console.error("Failed to parse JSON from Blob:", e);
          }
        };
        reader.readAsText(blob);
      }
    });

    let msg = await _parsePromise;

    this.emit("message", msg);
  }
}

[
  "binaryType",
  "bufferedAmount",
  "extensions",
  "protocol",
  "readyState",
  "url",
  "keepAliveTimeout",
  "keepAliveInterval",
  "shouldRetryFn",
  "connectionTimeout",
  "maxReconnectAttempts",
  "reconnectInterval",
].forEach((property) => {
  Object.defineProperty(ReconnectingWebSocket.prototype, property, {
    enumerable: true,
  });
});

["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach((property) => {
  Object.defineProperty(ReconnectingWebSocket.prototype, property, {
    enumerable: true,
    value: readyStates.indexOf(property),
  });
});

["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach((property) => {
  Object.defineProperty(ReconnectingWebSocket, property, {
    enumerable: true,
    value: readyStates.indexOf(property),
  });
});
