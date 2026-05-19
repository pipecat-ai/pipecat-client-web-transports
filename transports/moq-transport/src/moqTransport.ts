/*
 * Copyright (c) 2024-2026, Daily
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

import * as Moq from "@moq/lite";
import {
  type PipecatClientOptions,
  type RTVIEventCallbacks,
  RTVIMessage,
  RTVIError,
  Transport,
  type Tracks,
  type TransportState,
} from "@pipecat-ai/client-js";

/**
 * AudioWorklet that converts the mic's float32 PCM to 16-bit little-endian
 * PCM and posts each frame back to the main thread. Ported verbatim from
 * `moq_prebuilt/client/app.js` so we keep wire compatibility with the
 * Python bot (16 kHz, mono, s16le) while the rest of the transport gets
 * shaped up. Compiles to a blob URL at runtime via `URL.createObjectURL`.
 */
const WORKLET_CODE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      const floats = input[0];
      const pcm = new Int16Array(floats.length);
      for (let i = 0; i < floats.length; i++) {
        pcm[i] = Math.max(-32768, Math.min(32767, Math.round(floats[i] * 32768)));
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

const MIC_SAMPLE_RATE = 16000;
const PLAYBACK_SAMPLE_RATE = 24000;
const AUDIO_TRACK_PRIORITY = 128;

/**
 * Constructor options for the MoQ transport.
 *
 * Day 1 surface — only the bits needed for the moq-lite handshake. Device
 * pickers, track selection, transcript routing arrive in later iterations.
 */
export interface MoqTransportOptions {
  /**
   * URL of the moq-lite relay. WebTransport (HTTPS/HTTP3) by default; if
   * the browser can't reach it via WebTransport, @moq/lite falls back to
   * WebSocket automatically.
   */
  relayUrl: string;

  /**
   * For local development relays with self-signed certs. Same shape as
   * the native WebTransport `serverCertificateHashes` option.
   */
  serverCertificateHashes?: WebTransportHash[];

  /**
   * This client's participant id. Combined with `namespace` it forms the
   * broadcast path this client publishes under: `<namespace>/<clientId>`.
   * Defaults to "client0" — matches the current hand-rolled UI default.
   */
  clientId?: string;

  /**
   * The peer (bot) participant id to subscribe to. Subscriptions target
   * `<namespace>/<botId>/<track>`.
   */
  botId?: string;

  /**
   * Top-level namespace (analogous to a room name). Defaults to "pipecat".
   */
  namespace?: string;

  /**
   * Track name the client publishes its mic on. The bot subscribes to
   * `<namespace>/<clientId>/<publishTrack>`. Defaults to "user-audio".
   */
  publishTrack?: string;

  /**
   * Track name the client subscribes to inside the bot's broadcast.
   * Resolved path: `<namespace>/<botId>/<subscribeTrack>`. Defaults to
   * "bot-audio".
   */
  subscribeTrack?: string;

  /**
   * Track name for RTVI server→client messages (transcripts, bot-ready,
   * speech events, etc.). The client subscribes at
   * `<namespace>/<botId>/<transcriptTrack>`. Defaults to "transcript".
   */
  transcriptTrack?: string;

  /**
   * Track name for RTVI client→server messages (client-ready, custom
   * messages). The client publishes at
   * `<namespace>/<clientId>/<messageTrack>`. Defaults to "user-message".
   *
   * Note: the bot side needs to SUBSCRIBE to this track for messages to
   * flow. If it doesn't, `sendMessage()` is a silent no-op.
   */
  messageTrack?: string;
}

/**
 * `MoqTransport` — Pipecat Client SDK transport plugin for Media-over-QUIC.
 *
 * Day 2 scope: device enumeration, mic capture via AudioWorklet, and
 * reactive publish via `@moq/lite` (the bot's SUBSCRIBE triggers writes).
 * Bot-audio playback, the transcript track, and the full RTVI message
 * channel still stubbed until Days 3–4.
 */
export class MoqTransport extends Transport {
  public static SERVICE_NAME = "moq-transport";

  // Connection options provided to the constructor (with defaults applied).
  private _moqOptions: MoqTransportOptions;

  // The active moq-lite connection, populated by `_connect`.
  private _established: Moq.Connection.Established | undefined;

  // The broadcast this client publishes under (`<namespace>/<clientId>`).
  // Registered with `_established.publish(...)` in `_connect` and torn
  // down in `_disconnect`. The bot SUBSCRIBEs into this broadcast.
  private _publishBroadcast: Moq.Broadcast | undefined;

  // The currently-active outbound audio track. Set when the bot subscribes
  // to our user-audio track; the worklet writes PCM frames to it.
  private _activeAudioTrack: Moq.Track | undefined;

  // The currently-active outbound RTVI message track. Set when the bot
  // subscribes to our user-message track; `sendMessage()` writes to it.
  private _activeMessageTrack: Moq.Track | undefined;

  // Bot transcript subscription state. Frames are UTF-8 JSON RTVI messages.
  private _botTranscriptMoqTrack: Moq.Track | undefined;

  // Bot audio subscription state.
  private _botBroadcast: Moq.Broadcast | undefined;
  private _botAudioMoqTrack: Moq.Track | undefined;
  private _playbackContext: AudioContext | undefined;
  private _playbackDestination: MediaStreamAudioDestinationNode | undefined;
  private _botAudioTrack: MediaStreamTrack | undefined;
  private _playbackTime = 0;

  // Mic capture state.
  private _micStream: MediaStream | undefined;
  private _micTrack: MediaStreamTrack | undefined;
  private _audioContext: AudioContext | undefined;
  private _micWorklet: AudioWorkletNode | undefined;

  // Device picker state.
  private _knownMics: MediaDeviceInfo[] = [];
  private _selectedMicId: string | undefined;

  // Transport lifecycle state. Mirrored to `_callbacks.onTransportStateChanged`.
  declare protected _state: TransportState;

  constructor(options: MoqTransportOptions) {
    super();
    this._moqOptions = {
      namespace: "pipecat",
      clientId: "client0",
      botId: "bot0",
      publishTrack: "user-audio",
      subscribeTrack: "bot-audio",
      transcriptTrack: "transcript",
      messageTrack: "user-message",
      ...options,
    };
    this._state = "disconnected";
  }

  // --------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------

  initialize(
    options: PipecatClientOptions,
    messageHandler: (ev: RTVIMessage) => void,
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? ({} as RTVIEventCallbacks);
    this._onMessage = messageHandler;
    this.state = "initialized";
  }

  async initDevices(): Promise<void> {
    // Acquire the mic up front so the device list comes back with labels.
    // The MediaStreamTrack lives for the duration of the transport.
    if (this._micTrack) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: MIC_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
        },
      });
    } catch (err) {
      throw new RTVIError(
        `MoqTransport could not acquire microphone: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    this._micStream = stream;
    this._micTrack = stream.getAudioTracks()[0];

    const settings = this._micTrack?.getSettings();
    this._selectedMicId = settings?.deviceId;

    // Build the AudioWorklet pipeline. The worklet posts s16le PCM frames
    // back to the main thread; we route them to the active outbound MoQ
    // track if one is bound, or drop them otherwise.
    const ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, "pcm-capture");
    worklet.port.onmessage = (e) => this._writePcmFrame(new Uint8Array(e.data));
    source.connect(worklet);
    worklet.connect(ctx.destination);

    this._audioContext = ctx;
    this._micWorklet = worklet;

    // Refresh the cached device list now that the permission prompt has
    // settled — `enumerateDevices()` only returns labels post-permission.
    this._knownMics = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "audioinput",
    );
  }

  _validateConnectionParams(connectParams?: unknown): MoqTransportOptions {
    if (connectParams === undefined || connectParams === null) {
      return this._moqOptions;
    }
    if (typeof connectParams !== "object") {
      throw new RTVIError("MoqTransport connect params must be an object");
    }
    return { ...this._moqOptions, ...(connectParams as Partial<MoqTransportOptions>) };
  }

  async _connect(connectParams?: MoqTransportOptions): Promise<void> {
    const opts = connectParams ?? this._moqOptions;
    if (!opts.relayUrl) {
      throw new RTVIError("MoqTransport requires `relayUrl`");
    }

    this.state = "connecting";

    try {
      const url = new URL(opts.relayUrl);
      this._established = await Moq.Connection.connect(url, {
        webtransport: opts.serverCertificateHashes
          ? { serverCertificateHashes: opts.serverCertificateHashes }
          : undefined,
      });
    } catch (err) {
      this.state = "error";
      throw new RTVIError(
        `MoqTransport failed to connect to relay ${opts.relayUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    this.state = "connected";

    // Watch for relay-initiated close so the SDK consumer learns about
    // network drops.
    this._established.closed.then(() => {
      if (this._state !== "disconnected" && this._state !== "disconnecting") {
        this.state = "disconnected";
      }
    });

    // Register the publish broadcast at <namespace>/<clientId>. The bot
    // discovers it via the relay's ANNOUNCE_PLEASE flow and then sends
    // SUBSCRIBEs for our publish + message tracks; those subscribes land
    // on `_runPublishLoop` below.
    const ns = opts.namespace ?? "pipecat";
    const clientPath = Moq.Path.from(ns, opts.clientId ?? "client0");
    const broadcast = new Moq.Broadcast();
    this._established.publish(clientPath, broadcast);
    this._publishBroadcast = broadcast;
    this._runPublishLoop(
      broadcast,
      opts.publishTrack ?? "user-audio",
      opts.messageTrack ?? "user-message",
    ).catch((err) => {
      // The loop only throws if the broadcast aborted unexpectedly. Log
      // and let the consumer fall back to disconnect handling.
      console.warn("MoqTransport publish loop ended:", err);
    });

    // Subscribe to the bot's broadcast and its two tracks: audio (PCM)
    // and transcript (UTF-8 JSON RTVI messages).
    const botPath = Moq.Path.from(ns, opts.botId ?? "bot0");
    const botBroadcast = this._established.consume(botPath);
    this._botBroadcast = botBroadcast;

    // Bot audio: s16le PCM at PLAYBACK_SAMPLE_RATE. Decoded and routed
    // both to the speakers and a MediaStreamAudioDestinationNode so
    // `tracks().bot.audio` returns a real MediaStreamTrack.
    const botAudio = botBroadcast.subscribe(
      opts.subscribeTrack ?? "bot-audio",
      AUDIO_TRACK_PRIORITY,
    );
    this._botAudioMoqTrack = botAudio;
    this._consumeBotAudio(botAudio).catch((err) => {
      console.warn("MoqTransport bot-audio consume loop ended:", err);
    });

    // Bot transcript: each frame is a UTF-8 JSON RTVI message
    // (bot-ready, user-transcription, bot-output, bot-llm-*, etc.). We
    // hand each one to PipecatClient via `_onMessage`.
    const botTranscript = botBroadcast.subscribe(
      opts.transcriptTrack ?? "transcript",
      AUDIO_TRACK_PRIORITY,
    );
    this._botTranscriptMoqTrack = botTranscript;
    this._consumeBotTranscript(botTranscript).catch((err) => {
      console.warn("MoqTransport bot-transcript consume loop ended:", err);
    });

    // Transition to "connected" — `sendReadyMessage` will move us to
    // "ready" once PipecatClient calls it, matching the pattern in
    // `@pipecat-ai/small-webrtc-transport`.
    this.state = "connected";
  }

  async _disconnect(): Promise<void> {
    if (this._state === "disconnected") return;
    this.state = "disconnecting";
    try {
      this._botAudioMoqTrack?.close();
      this._botTranscriptMoqTrack?.close();
      this._botBroadcast?.close();
      this._publishBroadcast?.close();
      this._activeAudioTrack = undefined;
      this._activeMessageTrack = undefined;
      this._botAudioMoqTrack = undefined;
      this._botTranscriptMoqTrack = undefined;
      this._botBroadcast = undefined;
      this._publishBroadcast = undefined;
      this._established?.close();
    } finally {
      this._established = undefined;
      this._teardownMic();
      this._teardownPlayback();
      this.state = "disconnected";
    }
  }

  sendReadyMessage(): void {
    // Match the small-webrtc-transport pattern: flip to "ready" and send
    // the RTVI client-ready message. PipecatClient.connect() resolves
    // when the bot replies with a bot-ready message on the transcript
    // track (handled in `_consumeBotTranscript`).
    this.state = "ready";
    this.sendMessage(RTVIMessage.clientReady());
  }

  // --------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------

  get state(): TransportState {
    return this._state;
  }

  set state(next: TransportState) {
    if (this._state === next) return;
    this._state = next;
    this._callbacks?.onTransportStateChanged?.(next);
  }

  // --------------------------------------------------------------------
  // Devices
  // --------------------------------------------------------------------

  async getAllMics(): Promise<MediaDeviceInfo[]> {
    if (this._knownMics.length === 0) {
      // initDevices hasn't run yet — populate from a permission-less
      // enumerate call so the picker has something to show. Labels will
      // be empty strings until the user grants mic permission.
      this._knownMics = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "audioinput",
      );
    }
    return this._knownMics;
  }

  async getAllCams(): Promise<MediaDeviceInfo[]> {
    return [];
  }

  async getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    return [];
  }

  updateMic(micId: string): void {
    if (micId === this._selectedMicId) return;
    void this._swapMic(micId);
  }

  updateCam(_camId: string): void {}

  updateSpeaker(_speakerId: string): void {}

  get selectedMic(): MediaDeviceInfo | Record<string, never> {
    if (!this._selectedMicId) return {};
    return (
      this._knownMics.find((d) => d.deviceId === this._selectedMicId) ?? {}
    );
  }

  get selectedCam(): MediaDeviceInfo | Record<string, never> {
    return {};
  }

  get selectedSpeaker(): MediaDeviceInfo | Record<string, never> {
    return {};
  }

  enableMic(enable: boolean): void {
    if (!this._micTrack) return;
    this._micTrack.enabled = enable;
  }

  enableCam(_enable: boolean): void {}

  enableScreenShare(_enable: boolean): void {}

  get isCamEnabled(): boolean {
    return false;
  }

  get isMicEnabled(): boolean {
    return this._micTrack?.enabled ?? false;
  }

  get isSharingScreen(): boolean {
    return false;
  }

  // --------------------------------------------------------------------
  // Messaging + tracks
  // --------------------------------------------------------------------

  sendMessage(message: RTVIMessage): void {
    const track = this._activeMessageTrack;
    if (!track) {
      // The bot hasn't SUBSCRIBE'd to our message track yet, so we have
      // nowhere to write. Drop silently — the message channel is best-
      // effort and the bot side may not implement it at all.
      return;
    }
    try {
      const payload = new TextEncoder().encode(JSON.stringify(message));
      track.writeFrame(payload);
    } catch (err) {
      console.warn("MoqTransport sendMessage failed:", err);
    }
  }

  tracks(): Tracks {
    return {
      local: this._micTrack ? { audio: this._micTrack } : {},
      bot: this._botAudioTrack ? { audio: this._botAudioTrack } : {},
    };
  }

  // --------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------

  /**
   * Wait for the bot to SUBSCRIBE to our publish tracks (audio + RTVI
   * messages), then bind each incoming `Moq.Track` to the corresponding
   * write path. Loops so we re-bind on each fresh SUBSCRIBE (e.g. bot
   * reconnect).
   */
  private async _runPublishLoop(
    broadcast: Moq.Broadcast,
    publishTrackName: string,
    messageTrackName: string,
  ): Promise<void> {
    for (;;) {
      const req = await broadcast.requested();
      if (!req) return;
      if (req.track.name === publishTrackName) {
        this._activeAudioTrack = req.track;
        req.track.closed.then(() => {
          if (this._activeAudioTrack === req.track) {
            this._activeAudioTrack = undefined;
          }
        });
      } else if (req.track.name === messageTrackName) {
        this._activeMessageTrack = req.track;
        req.track.closed.then(() => {
          if (this._activeMessageTrack === req.track) {
            this._activeMessageTrack = undefined;
          }
        });
      } else {
        // Unknown track — reject so the relay can try other publishers.
        req.track.close(new Error(`unknown track: ${req.track.name}`));
      }
    }
  }

  /**
   * Drain UTF-8 JSON RTVI messages from the bot's transcript track and
   * hand each one to PipecatClient via the message handler that
   * `initialize()` wired up. PipecatClient routes them to the
   * appropriate event callback (onUserTranscript, onBotTtsText, onBotReady,
   * etc.) and resolves the connect promise when bot-ready arrives.
   */
  private async _consumeBotTranscript(track: Moq.Track): Promise<void> {
    const decoder = new TextDecoder();
    for (;;) {
      const frame = await track.readFrame();
      if (!frame) return;
      if (frame.byteLength === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoder.decode(frame));
      } catch (err) {
        console.warn("MoqTransport transcript frame parse error:", err);
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      this._onMessage?.(parsed as RTVIMessage);
    }
  }

  /** Write one PCM frame to the active audio track, if one is bound. */
  private _writePcmFrame(bytes: Uint8Array): void {
    const track = this._activeAudioTrack;
    if (!track) return;
    try {
      track.writeFrame(bytes);
    } catch (err) {
      // Track was closed mid-write; drop and let the closed-handler
      // clear `_activeAudioTrack`.
      console.warn("MoqTransport audio writeFrame failed:", err);
    }
  }

  /** Swap to a different mic device without tearing down the worklet. */
  private async _swapMic(deviceId: string): Promise<void> {
    if (!this._audioContext) {
      // initDevices hasn't run — just remember the choice for next start.
      this._selectedMicId = deviceId;
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          sampleRate: MIC_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
        },
      });
    } catch (err) {
      console.warn("MoqTransport updateMic failed:", err);
      return;
    }
    // Tear down the previous source/track and wire up the new one.
    this._micStream?.getTracks().forEach((t) => t.stop());
    this._micStream = stream;
    this._micTrack = stream.getAudioTracks()[0];
    this._selectedMicId = this._micTrack?.getSettings().deviceId ?? deviceId;
    const source = this._audioContext.createMediaStreamSource(stream);
    if (this._micWorklet) source.connect(this._micWorklet);
  }

  /** Stop the mic, close the AudioContext, drop references. */
  private _teardownMic(): void {
    this._micWorklet?.disconnect();
    this._micStream?.getTracks().forEach((t) => t.stop());
    this._audioContext?.close().catch(() => {});
    this._micWorklet = undefined;
    this._micStream = undefined;
    this._micTrack = undefined;
    this._audioContext = undefined;
  }

  /**
   * Drain s16le PCM frames from the bot's audio track and play them.
   * Each frame becomes an `AudioBufferSourceNode` scheduled head-to-tail
   * with the previous one (gapless playback), and is fanned out to both
   * the speakers and a `MediaStreamAudioDestinationNode` so the synthesized
   * `_botAudioTrack` reflects what the user actually hears.
   */
  private async _consumeBotAudio(track: Moq.Track): Promise<void> {
    for (;;) {
      const frame = await track.readFrame();
      if (!frame) return;
      if (frame.byteLength < 2) continue;
      this._playPcmFrame(frame);
    }
  }

  /** Lazy-init the playback AudioContext + synthesized MediaStreamTrack. */
  private _ensurePlaybackContext(): {
    ctx: AudioContext;
    dest: MediaStreamAudioDestinationNode;
  } {
    if (this._playbackContext && this._playbackDestination) {
      return { ctx: this._playbackContext, dest: this._playbackDestination };
    }
    const ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
    const dest = ctx.createMediaStreamDestination();
    this._playbackContext = ctx;
    this._playbackDestination = dest;
    this._botAudioTrack = dest.stream.getAudioTracks()[0];
    return { ctx, dest };
  }

  /** Decode one s16le PCM frame to an AudioBuffer and schedule it. */
  private _playPcmFrame(bytes: Uint8Array): void {
    const { ctx, dest } = this._ensurePlaybackContext();

    // Copy to an aligned buffer — incoming Uint8Array byteOffset may be
    // odd, which would reject the Int16Array view.
    const aligned = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(aligned).set(bytes);
    const int16 = new Int16Array(aligned);
    const sampleCount = int16.length;

    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      channel[i] = int16[i] / 32768;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.connect(dest);

    const startAt = Math.max(ctx.currentTime, this._playbackTime);
    source.start(startAt);
    this._playbackTime = startAt + buffer.duration;
  }

  /** Stop bot-audio playback, close the playback context, drop the track. */
  private _teardownPlayback(): void {
    this._botAudioTrack?.stop();
    this._playbackContext?.close().catch(() => {});
    this._playbackContext = undefined;
    this._playbackDestination = undefined;
    this._botAudioTrack = undefined;
    this._playbackTime = 0;
  }
}
