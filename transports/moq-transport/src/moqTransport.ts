/*
 * Copyright (c) 2024-2026, Daily
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

import * as Moq from "@moq/net";
import * as Publish from "@moq/publish";
import * as Watch from "@moq/watch";
import { Effect, Signal } from "@moq/signals";
import {
  type PipecatClientOptions,
  type RTVIEventCallbacks,
  RTVIMessage,
  RTVIError,
  Transport,
  type Tracks,
  type TransportState,
} from "@pipecat-ai/client-js";

const DEFAULT_NAMESPACE = "pipecat";
const DEFAULT_CLIENT_ID = "client0";
const DEFAULT_BOT_ID = "bot0";
const DEFAULT_TRANSCRIPT_TRACK = "transcript";
// Bounded jitter buffer on the audio decoder. Lower = more interactive
// but more drops on bad networks. Matches the bot's audio_in_max_latency_ms
// in spirit (each side enforces its own deadline).
const DEFAULT_AUDIO_LATENCY_MS = 80;
// Latency ceiling for buffered TTS playback (ms). A finite cap (vs
// uncapped) because the player's group/jitter buffer needs a concrete
// maximum span to retain before dropping. The bot paces its writes a
// little under this (~25s, see the Python transport's
// `audio_out_max_buffer_ms`) so the producer self-limits below this drop
// ceiling and the player never actually has to drop.
const DEFAULT_AUDIO_BUFFER_MAX_MS = 30 * 1000;

/**
 * Constructor options for the MoQ transport.
 *
 * The browser dials a MOQ peer (relay or bot in serve mode) at
 * ``relayUrl`` and publishes its mic under ``<namespace>/<clientId>``
 * while consuming the bot under ``<namespace>/<botId>``. Audio tracks
 * inside each broadcast are catalog-driven (codec, sample rate, channel
 * count are discovered at connect time), so they aren't pinned here.
 */
export interface MoqTransportOptions {
  /**
   * Full URL of the MOQ peer (e.g. ``https://relay.example.com:4080/moq``).
   * WebTransport (HTTPS/HTTP3); @moq/net races WebSocket as a fallback
   * if WebTransport isn't reachable.
   */
  relayUrl: string;

  /**
   * Pinned cert hashes for self-signed dev setups. Same shape as the
   * native WebTransport ``serverCertificateHashes`` option.
   */
  serverCertificateHashes?: WebTransportHash[];

  /**
   * This client's participant id. Combined with ``namespace`` it forms
   * the broadcast path the client publishes under: ``<namespace>/<clientId>``.
   */
  clientId?: string;

  /**
   * The peer (bot) participant id to consume. Subscriptions target
   * ``<namespace>/<botId>``; track names come from the bot's catalog.
   */
  botId?: string;

  /**
   * Top-level namespace (analogous to a room name). Defaults to ``"pipecat"``.
   */
  namespace?: string;

  /**
   * Track name for RTVI server→client messages (transcripts, bot-ready,
   * speech events, etc.). The client subscribes at
   * ``<namespace>/<botId>/<transcriptTrack>``. Defaults to ``"transcript"``.
   *
   * Stays pinned because the transcript is a non-media byte track —
   * the catalog only describes media tracks (audio/video).
   */
  transcriptTrack?: string;

  /**
   * Latency floor (ms) — the jitter buffer the player keeps before
   * playback. Lower = more interactive, more drops; higher = smoother,
   * more glass-to-glass delay. Maps to ``@moq/watch`` ``Sync.latencyMin``.
   */
  audioLatencyMs?: number;

  /**
   * Latency ceiling for buffered playback (``@moq/watch`` ``Sync.latencyMax``).
   *
   * The bot writes TTS audio faster than real-time with future-dated
   * timestamps; the player buffers it and plays at the encoded pace
   * instead of skipping ahead. This sets how much it's allowed to build
   * up before re-anchoring:
   *
   * - a number (default: 30 s) — cap the buffer at that many ms. The
   *   player retains up to this much faster-than-real-time audio before
   *   dropping; an interruption (``user-started-speaking``) flushes early
   *   via ``reset()``. A finite cap is required: it's the concrete maximum
   *   span the player's group/jitter buffer holds. The bot paces a little
   *   under this so it never actually overruns the cap.
   * - ``"none"`` — uncapped. Avoid: the container consumer needs a finite
   *   ceiling, so uncapped falls back to the floor and skips ahead.
   * - ``"real-time"`` — collapse to the floor (minimize latency, the old
   *   skip-ahead behavior; only useful with a live, real-time publisher).
   */
  audioBufferMaxMs?: number | "none" | "real-time";
}

interface ResolvedOptions {
  relayUrl: string;
  serverCertificateHashes?: WebTransportHash[];
  clientId: string;
  botId: string;
  namespace: string;
  transcriptTrack: string;
  audioLatencyMs: number;
  audioBufferMaxMs: number | "none" | "real-time";
}

function applyDefaults(opts: MoqTransportOptions): ResolvedOptions {
  return {
    relayUrl: opts.relayUrl,
    serverCertificateHashes: opts.serverCertificateHashes,
    clientId: opts.clientId ?? DEFAULT_CLIENT_ID,
    botId: opts.botId ?? DEFAULT_BOT_ID,
    namespace: opts.namespace ?? DEFAULT_NAMESPACE,
    transcriptTrack: opts.transcriptTrack ?? DEFAULT_TRANSCRIPT_TRACK,
    audioLatencyMs: opts.audioLatencyMs ?? DEFAULT_AUDIO_LATENCY_MS,
    audioBufferMaxMs: opts.audioBufferMaxMs ?? DEFAULT_AUDIO_BUFFER_MAX_MS,
  };
}

/**
 * ``MoqTransport`` — Pipecat Client SDK transport plugin for Media-over-QUIC.
 *
 * Built on the official ``moq`` library family:
 *
 * - ``@moq/net`` for connection management (``Connection.Reload``
 *   auto-reconnects on drops; races WebTransport + WebSocket).
 * - ``@moq/publish`` for mic capture and Opus encoding. ``Publish.Broadcast``
 *   wraps a microphone source and publishes both the catalog and the
 *   audio track; subscribe fulfilment is handled internally.
 * - ``@moq/hang`` for catalog parsing and bounded-latency audio
 *   consumption (``Container.Consumer``).
 * - ``@moq/signals`` for reactive plumbing (re-runs the consume loops
 *   on each reconnect without manual wiring).
 *
 * Catalog discovery (instead of pinned track names) lets the bot pick
 * its own codec and sample rate; we read whatever it advertises.
 */
export class MoqTransport extends Transport {
  public static SERVICE_NAME = "moq-transport";

  // Resolved options (defaults applied), captured at construction time
  // and overridden by `_validateConnectionParams` at connect time.
  private _moqOptions: ResolvedOptions;

  // @moq/net state — owned across the lifetime of one `_connect`/`_disconnect`.
  private _reload: Moq.Connection.Reload | null = null;
  private _statusEffect: Effect | null = null;
  private _consumeEffect: Effect | null = null;

  // Publish side (mic → bot).
  private _publishBroadcast: Publish.Broadcast | null = null;
  private _micEnabled = new Signal(true);

  // Bot audio playback via @moq/watch (buffered playback, PR #1620).
  // The watch chain (Broadcast -> Audio.Source -> Decoder -> Emitter)
  // decodes Opus into an AudioWorklet-backed ring buffer and plays it at
  // the encoded pace; `Sync.latencyMax` lets faster-than-real-time TTS
  // build up a buffer instead of the player skipping ahead, and
  // `reset()` flushes that buffer on interruption.
  private _botBroadcast: Watch.Broadcast | null = null;
  private _botSync: Watch.Sync | null = null;
  private _botAudioSource: Watch.Audio.Source | null = null;
  private _botAudioDecoder: Watch.Audio.Decoder | null = null;
  private _botAudioEmitter: Watch.Audio.Emitter | null = null;
  private _botAudioEffect: Effect | null = null;
  // Tapped off the decoder's worklet so `tracks().bot.audio` returns a
  // `MediaStreamTrack` the consumer can plug into a visualizer.
  private _botAudioTrack: MediaStreamTrack | undefined;
  private _botMsDest: MediaStreamAudioDestinationNode | undefined;

  // Mic device picker state — we expose the device list to the SDK so
  // consumers can show a picker. `Publish.Source.Microphone` handles
  // the actual `getUserMedia` call.
  private _knownMics: MediaDeviceInfo[] = [];
  private _selectedMicId: string | undefined;
  private _localAudioTrack: MediaStreamTrack | undefined;

  // Transport lifecycle state. Mirrored to `_callbacks.onTransportStateChanged`.
  declare protected _state: TransportState;

  constructor(options: MoqTransportOptions) {
    super();
    this._moqOptions = applyDefaults(options);
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
    // Lazy-acquire mic permission so `getAllMics()` returns labels.
    // `Publish.Source.Microphone` (used inside `_connect`) does its own
    // `getUserMedia` later — we keep the pre-permission probe here so
    // a picker can populate before the user clicks Connect.
    if (this._localAudioTrack) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
      });
      this._localAudioTrack = stream.getAudioTracks()[0];
      this._selectedMicId = this._localAudioTrack?.getSettings().deviceId;
    } catch (err) {
      throw new RTVIError(
        `MoqTransport could not acquire microphone: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    this._knownMics = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "audioinput",
    );
  }

  _validateConnectionParams(connectParams?: unknown): MoqTransportOptions {
    if (connectParams === undefined || connectParams === null) {
      return this._optionsAsInput();
    }
    if (typeof connectParams !== "object") {
      throw new RTVIError("MoqTransport connect params must be an object");
    }
    return { ...this._optionsAsInput(), ...(connectParams as Partial<MoqTransportOptions>) };
  }

  /** Return the resolved options re-shaped to the public input type
   *  (used when merging with connect-time params). */
  private _optionsAsInput(): MoqTransportOptions {
    return { ...this._moqOptions };
  }

  async _connect(connectParams?: MoqTransportOptions): Promise<void> {
    const merged = connectParams
      ? { ...this._moqOptions, ...applyDefaults({ ...this._moqOptions, ...connectParams }) }
      : this._moqOptions;
    if (!merged.relayUrl) {
      throw new RTVIError("MoqTransport requires `relayUrl`");
    }
    this._moqOptions = merged;

    this.state = "connecting";

    let url: URL;
    try {
      url = new URL(merged.relayUrl);
    } catch (err) {
      this.state = "error";
      throw new RTVIError(
        `MoqTransport invalid relayUrl ${JSON.stringify(merged.relayUrl)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const webtransport: { serverCertificateHashes?: WebTransportHash[] } = {};
    if (merged.serverCertificateHashes) {
      webtransport.serverCertificateHashes = merged.serverCertificateHashes;
    }

    // Reload auto-reconnects on disconnect. Publish.Broadcast and the
    // consume effect below both react to its `established` signal.
    this._reload = new Moq.Connection.Reload({
      enabled: new Signal(true),
      url: new Signal(url),
      webtransport,
    });

    // Mirror Reload's status into our transport state. `connected` here
    // means the MoQ session is up; the SDK flips to `ready` separately
    // via `sendReadyMessage`.
    this._statusEffect = new Effect();
    this._statusEffect.run((eff) => {
      const status = eff.get(this._reload!.status);
      if (status === "connected") {
        if (this._state === "connecting") this.state = "connected";
      } else if (status === "connecting") {
        this.state = "connecting";
      } else if (status === "disconnected") {
        if (this._state !== "disconnecting" && this._state !== "disconnected") {
          this.state = "disconnected";
        }
      }
    });

    const ourPath = Moq.Path.from(merged.namespace, merged.clientId);
    const botPath = Moq.Path.from(merged.namespace, merged.botId);

    // ----------------------------------------------------------------
    // Publish — get the mic ourselves so we can pin `channelCount: 1`
    // (the bot's Opus decoder won't downmix; `{ exact: 1 }` makes the
    // constraint mandatory). Then hand the track to `Publish.Broadcast`
    // as its audio source. We bypass `Publish.Source.Microphone` here
    // because 0.2.9 didn't appear to honor `constraints.channelCount`
    // on this stack — observed `channels=2` in the bot's catalog read
    // even with the constraint set.
    // ----------------------------------------------------------------
    let micTrack: MediaStreamTrack;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { exact: 1 },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micTrack = stream.getAudioTracks()[0];
    } catch (err) {
      this.state = "error";
      throw new RTVIError(
        `MoqTransport could not acquire mono microphone: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    this._localAudioTrack = micTrack;
    const settings = micTrack.getSettings();
    console.log(
      `[MoqTransport] mic acquired — channels=${settings.channelCount}, ` +
        `sampleRate=${settings.sampleRate}, deviceId=${settings.deviceId}`,
    );

    const micSource = new Signal<Publish.Audio.Source | undefined>(
      micTrack as Publish.Audio.StreamTrack,
    );
    this._publishBroadcast = new Publish.Broadcast({
      connection: this._reload.established,
      enabled: new Signal(true),
      name: new Signal(ourPath),
      audio: {
        source: micSource,
        enabled: this._micEnabled,
      },
    });

    // ----------------------------------------------------------------
    // Consume bot audio via @moq/watch. The watch Broadcast reacts to
    // the connection signal itself (`reload: true`), so this is set up
    // once rather than per-reconnect.
    // ----------------------------------------------------------------
    this._setupBotAudio(botPath);

    // ----------------------------------------------------------------
    // Consume the transcript (raw RTVI byte track) — re-run on each
    // successful (re)connect.
    // ----------------------------------------------------------------
    this._consumeEffect = new Effect();
    this._consumeEffect.run((eff) => {
      const conn = eff.get(this._reload!.established);
      if (!conn) return;

      const botBroadcast = conn.consume(botPath);

      const ac = new AbortController();
      this._consumeBotTranscript(botBroadcast, ac.signal).catch((e) => {
        if (!ac.signal.aborted) {
          console.warn("MoqTransport bot-transcript loop:", e);
        }
      });

      eff.cleanup(() => ac.abort());
    });
  }

  async _disconnect(): Promise<void> {
    if (this._state === "disconnected") return;
    this.state = "disconnecting";
    try {
      this._consumeEffect?.close();
      this._statusEffect?.close();
      this._publishBroadcast?.close();
      this._teardownBotAudio();
      this._localAudioTrack?.stop();
      try {
        this._reload?.signals.close();
      } catch {
        // best-effort.
      }
    } finally {
      this._consumeEffect = null;
      this._statusEffect = null;
      this._publishBroadcast = null;
      this._localAudioTrack = undefined;
      this._reload = null;
      this.state = "disconnected";
    }
  }

  sendReadyMessage(): void {
    // In the moq-libs design the bot's `on_client_connected` fires
    // when it sees this client's broadcast announcement — no separate
    // client-ready RTVI message is needed (and there's no client→server
    // message channel by default). The SDK still expects this method
    // to flip state to `ready`.
    this.state = "ready";
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
    this._selectedMicId = micId;
    // Publish.Source.Microphone handles its own getUserMedia call
    // internally — at the time of this writing it doesn't accept a
    // deviceId. Future work: extend it (or replace with a custom
    // source) so the picker actually re-routes audio. For now we
    // remember the selection so `selectedMic` is consistent.
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
    this._micEnabled.set(enable);
    if (this._localAudioTrack) this._localAudioTrack.enabled = enable;
  }

  enableCam(_enable: boolean): void {}

  enableScreenShare(_enable: boolean): void {}

  get isCamEnabled(): boolean {
    return false;
  }

  get isMicEnabled(): boolean {
    return this._micEnabled.get();
  }

  get isSharingScreen(): boolean {
    return false;
  }

  // --------------------------------------------------------------------
  // Messaging + tracks
  // --------------------------------------------------------------------

  sendMessage(_message: RTVIMessage): void {
    // The catalog-driven moq-libs design doesn't carve out a dedicated
    // client→server RTVI message channel. Drop silently — best-effort
    // by contract, and currently the bot doesn't read this path.
  }

  tracks(): Tracks {
    return {
      local: this._localAudioTrack ? { audio: this._localAudioTrack } : {},
      bot: this._botAudioTrack ? { audio: this._botAudioTrack } : {},
    };
  }

  // --------------------------------------------------------------------
  // Internals — bot audio
  // --------------------------------------------------------------------

  /** The `Sync.latencyMax` value derived from `audioBufferMaxMs`.
   *  `"none"` -> `undefined` (uncapped buffering). Must be carried in a
   *  Signal because the Sync constructor treats a bare `undefined` prop
   *  as "real-time" (minimize); a Signal holding `undefined` is uncapped. */
  private _botLatencyMax(): Signal<Watch.Latency | undefined> {
    const v = this._moqOptions.audioBufferMaxMs;
    const value: Watch.Latency | undefined =
      v === "none" ? undefined : (v as unknown as Watch.Latency);
    return new Signal<Watch.Latency | undefined>(value);
  }

  /** Set up buffered bot-audio playback with @moq/watch:
   *  Broadcast -> Audio.Source -> Decoder -> Emitter, driven by a Sync
   *  configured for buffered (latencyMax) playback. The decoder's worklet
   *  output is tapped into a `MediaStreamDestination` so `tracks().bot.audio`
   *  exposes a `MediaStreamTrack` for visualizers. */
  private _setupBotAudio(botPath: Moq.Path.Valid): void {
    const established = this._reload!.established;

    const broadcast = new Watch.Broadcast({
      connection: established,
      enabled: new Signal(true),
      name: new Signal(botPath),
      // reload defaults to false: subscribe as soon as the connection is
      // established (matching the old `conn.consume(botPath)`), rather
      // than waiting for a broadcast announcement we don't wire up here.
      reload: new Signal(false),
    });

    const sync = new Watch.Sync({
      latencyMin: this._moqOptions.audioLatencyMs as unknown as Watch.Latency,
      latencyMax: this._botLatencyMax(),
      connection: established,
    });

    const source = new Watch.Audio.Source(sync, { broadcast });
    const decoder = new Watch.Audio.Decoder(source);
    // The Emitter plays to the speakers and, via `paused`/`muted`, drives
    // `decoder.enabled` so the track actually downloads + decodes.
    const emitter = new Watch.Audio.Emitter(decoder, { volume: 1 });

    // Tap the decoder's worklet into a MediaStream for `tracks().bot.audio`.
    const effect = new Effect();
    effect.run((eff) => {
      const ctx = eff.get(decoder.context);
      const root = eff.get(decoder.root);
      if (!ctx || !root) return;

      const msDest = ctx.createMediaStreamDestination();
      root.connect(msDest);
      this._botMsDest = msDest;
      this._botAudioTrack = msDest.stream.getAudioTracks()[0];

      eff.cleanup(() => {
        try {
          root.disconnect(msDest);
        } catch {
          // best-effort.
        }
        this._botAudioTrack = undefined;
        this._botMsDest = undefined;
      });
    });

    this._botBroadcast = broadcast;
    this._botSync = sync;
    this._botAudioSource = source;
    this._botAudioDecoder = decoder;
    this._botAudioEmitter = emitter;
    this._botAudioEffect = effect;
  }

  /** Flush buffered bot audio and re-anchor playback at an utterance
   *  boundary. Called on interruption (`user-started-speaking`) so the
   *  already-buffered TTS for the previous utterance stops immediately
   *  instead of draining: re-anchor the sync reference and flush the
   *  decoder's ring buffer. */
  private _resetBotAudio(): void {
    this._botSync?.reset();
    this._botAudioDecoder?.reset();
  }

  private _teardownBotAudio(): void {
    this._botAudioEffect?.close();
    this._botAudioEmitter?.close();
    this._botAudioDecoder?.close();
    this._botAudioSource?.close();
    this._botSync?.close();
    this._botBroadcast?.close();
    this._botAudioEffect = null;
    this._botAudioEmitter = null;
    this._botAudioDecoder = null;
    this._botAudioSource = null;
    this._botSync = null;
    this._botBroadcast = null;
    this._botAudioTrack = undefined;
    this._botMsDest = undefined;
  }


  /** Drain UTF-8 JSON RTVI messages from the bot's transcript track
   *  and hand each one to `PipecatClient` via `_onMessage`. The handler
   *  resolves the SDK's connect promise when bot-ready arrives. */
  private async _consumeBotTranscript(
    botBroadcast: ReturnType<Moq.Connection.Established["consume"]>,
    signal: AbortSignal,
  ): Promise<void> {
    const track = botBroadcast.subscribe(this._moqOptions.transcriptTrack, 0);
    signal.addEventListener("abort", () => {
      try {
        track.close();
      } catch {
        // best-effort.
      }
    });

    const decoder = new TextDecoder();
    try {
      for (;;) {
        const group = await track.recvGroup();
        if (!group || signal.aborted) break;
        for (;;) {
          const frame = await group.readFrame();
          if (!frame) break;
          if (frame.byteLength === 0) continue;
          try {
            const parsed = JSON.parse(decoder.decode(frame));
            if (parsed && typeof parsed === "object") {
              // Interruption: the user started talking, so flush the
              // already-buffered TTS for the bot's previous utterance
              // instead of letting it drain. With the bot no longer
              // pacing its writes, that buffer can be seconds long.
              if ((parsed as RTVIMessage).type === "user-started-speaking") {
                this._resetBotAudio();
              }
              this._onMessage?.(parsed as RTVIMessage);
            }
          } catch (err) {
            console.warn("MoqTransport transcript frame parse error:", err);
          }
        }
      }
    } catch (e) {
      if (!signal.aborted) {
        console.warn("MoqTransport transcript loop ended:", e);
      }
    }
  }

}
