/*
 * Copyright (c) 2024-2026, Daily
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

import * as Json from "@moq/json";
import * as Moq from "@moq/net";
import * as Publish from "@moq/publish";
import { Effect, Signal } from "@moq/signals";
import * as Watch from "@moq/watch";
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
// Sample rate we pin on the publish-side Opus encoder. Opus only supports
// {8, 12, 16, 24, 48} kHz; 48 kHz is the upstream default and what most
// browsers report as the mic's native rate. The bot reads this from our
// catalog and resamples to its `audio_in_sample_rate` after decode, so we
// don't need to match it exactly — but pinning it keeps the catalog
// unambiguous.
const DEFAULT_AUDIO_SAMPLE_RATE = 48000;

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
   * more glass-to-glass delay. Maps to the `min` bound of the
   * ``@moq/watch`` ``Sync.latency`` range.
   */
  audioLatencyMs?: number;

  /**
   * Latency ceiling for buffered playback (the `max` bound of the
   * ``@moq/watch`` ``Sync.latency`` range).
   *
   * The bot writes TTS audio faster than real-time with future-dated
   * timestamps; the player buffers it and plays at the encoded pace
   * instead of skipping ahead. This sets how much it's allowed to
   * build up before re-anchoring:
   *
   * - a number (default: 30 s) — cap the buffer at that many ms. The
   *   player retains up to this much faster-than-real-time audio before
   *   dropping; an interruption (``user-started-speaking``) flushes early
   *   via ``reset()``. The bot paces a little under this so it never
   *   actually overruns the cap.
   * - ``"real-time"`` — collapse to the floor (minimize latency, the old
   *   skip-ahead behavior; only useful with a live, real-time publisher).
   */
  audioBufferMaxMs?: number | "real-time";

  /**
   * Sample rate (Hz) the client publishes its mic audio at. Must be one
   * of Opus's supported rates: 8000, 12000, 16000, 24000, or 48000.
   * Defaults to ``48000`` to match the typical browser mic rate.
   *
   * The bot reads this from the client's catalog and resamples to its
   * own ``audio_in_sample_rate`` after Opus decode, so exact agreement
   * isn't required — pinning a known value just keeps the catalog
   * unambiguous.
   *
   * Bot-side playback sample rate isn't an option here: ``MoqTransport``
   * reads whatever the bot advertises in its catalog and configures its
   * playback ``AudioContext`` accordingly.
   */
  audioSampleRate?: number;
}

interface ResolvedOptions {
  relayUrl: string;
  serverCertificateHashes?: WebTransportHash[];
  clientId: string;
  botId: string;
  namespace: string;
  transcriptTrack: string;
  audioLatencyMs: number;
  audioBufferMaxMs: number | "real-time";
  audioSampleRate: number;
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
    audioSampleRate: opts.audioSampleRate ?? DEFAULT_AUDIO_SAMPLE_RATE,
  };
}

/**
 * ``MoqTransport`` — Pipecat Client SDK transport plugin for Media-over-QUIC.
 *
 * Built on the official ``moq`` library family:
 *
 * - ``@moq/net`` for connection management (``Connection.Reload``
 *   auto-reconnects on drops; races WebTransport + WebSocket).
 * - ``@moq/publish`` for mic capture and Opus encoding via
 *   ``Publish.Source.Microphone`` + ``Publish.Broadcast``.
 * - ``@moq/watch`` for bot audio playback: ``Watch.Broadcast`` discovers
 *   the catalog, ``Watch.Audio.Source`` picks a rendition, and
 *   ``Watch.Audio.Decoder`` + ``Watch.Audio.Emitter`` drive an
 *   ``AudioWorklet`` with a ring buffer (loss-tolerant, low-latency).
 * - ``@moq/json`` for the transcript track (snapshot + JSON Merge Patch).
 * - ``@moq/signals`` for reactive plumbing.
 */
export class MoqTransport extends Transport {
  public static SERVICE_NAME = "moq-transport";

  // Resolved options (defaults applied), captured at construction time
  // and overridden by `_validateConnectionParams` at connect time.
  private _moqOptions: ResolvedOptions;

  // Connection + reactive root.
  private _reload: Moq.Connection.Reload | null = null;
  private _signals: Effect | null = null;

  // Publish side (mic → bot).
  private _publishBroadcast: Publish.Broadcast | null = null;
  private _microphone: Publish.Source.Microphone | null = null;
  private _micEnabled = new Signal(true);
  private _micConstraints = new Signal<MediaTrackConstraints | undefined>(
    undefined,
  );
  private _preferredMicId = new Signal<string | undefined>(undefined);
  // Encoder sample rate is wired into the catalog the bot reads. We
  // expose this as a Signal so `_connect` can update it from the resolved
  // options at connect time.
  private _audioSampleRate = new Signal<number | undefined>(undefined);

  // Watch side (bot → playback). Buffered playback via @moq/watch:
  // Broadcast -> Audio.Source -> Decoder -> Emitter, with `Sync.latencyMax`
  // letting faster-than-real-time TTS build up instead of the player
  // skipping ahead, and `reset()` flushing the buffer on interruption.
  private _watchBroadcast: Watch.Broadcast | null = null;
  private _sync: Watch.Sync | null = null;
  private _audioSource: Watch.Audio.Source | null = null;
  private _audioDecoder: Watch.Audio.Decoder | null = null;
  private _audioEmitter: Watch.Audio.Emitter | null = null;

  // Synthesized `MediaStreamTrack` for the bot, so `tracks().bot.audio`
  // returns something a `<audio>` element / visualizer can consume.
  // Tapped off `Watch.Audio.Decoder.root` (an `AudioNode`) into a
  // `MediaStreamAudioDestinationNode`.
  private _botAudioTrack: MediaStreamTrack | undefined;

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
    // Spin up the Microphone with permission requested so labels are
    // available for the picker before the user clicks Connect. Real
    // capture constraints (incl. sample rate) get applied in `_connect`
    // once we have the resolved options.
    if (!this._microphone) {
      this._microphone = new Publish.Source.Microphone({
        enabled: this._micEnabled,
        constraints: this._micConstraints,
        device: { preferred: this._preferredMicId },
      });
    }
    this._microphone.device.requestPermission();
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

    // @moq/net narrows `algorithm` to the literal `"sha-256"`, while
    // the browser's `WebTransportHash` types it as `string`. Cast at
    // the boundary; SHA-256 is the only algorithm WebTransport accepts.
    const webtransport = merged.serverCertificateHashes
      ? {
          serverCertificateHashes: merged.serverCertificateHashes.flatMap(
            (h) =>
              h.value ? [{ algorithm: "sha-256" as const, value: h.value }] : [],
          ),
        }
      : undefined;

    // Reload auto-reconnects on disconnect; Publish.Broadcast and
    // Watch.Broadcast both react to its `established` signal.
    this._reload = new Moq.Connection.Reload({
      enabled: new Signal(true),
      url: new Signal(url),
      webtransport,
    });

    // One reactive root for status mirroring. Connect/Watch are
    // self-driving via their own internal effects.
    this._signals = new Effect();
    this._signals.run((eff) => {
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
    // Publish — Microphone owns getUserMedia, device selection, and
    // produces a reactive `source` signal that Publish.Broadcast
    // consumes. Constraints (channelCount:1, sampleRate) and preferred
    // deviceId flow through the signals we hold a reference to, so
    // updateMic() re-routes audio without re-creating the broadcast.
    // The encoder's sampleRate Signal pins what the catalog advertises.
    // ----------------------------------------------------------------
    this._micConstraints.set({
      channelCount: { exact: 1 },
      sampleRate: { ideal: merged.audioSampleRate },
      echoCancellation: true,
      noiseSuppression: true,
    });
    this._audioSampleRate.set(merged.audioSampleRate);

    if (!this._microphone) {
      this._microphone = new Publish.Source.Microphone({
        enabled: this._micEnabled,
        constraints: this._micConstraints,
        device: { preferred: this._preferredMicId },
      });
    }

    this._publishBroadcast = new Publish.Broadcast({
      connection: this._reload.established,
      enabled: new Signal(true),
      name: new Signal(ourPath),
      audio: {
        source: this._microphone.source,
        enabled: this._micEnabled,
        sampleRate: this._audioSampleRate,
      },
    });

    // Log the mic settings the browser actually granted, so we can see
    // when a UA ignores the constraint (e.g. macOS often pins 48k
    // regardless of `sampleRate.ideal`).
    this._signals.run((eff) => {
      const src = eff.get(this._microphone!.source);
      if (!src) return;
      const track = "track" in src ? src.track : src;
      const s = track.getSettings();
      console.log(
        `[MoqTransport] publish: requested=${merged.audioSampleRate}Hz, ` +
          `mic granted=${s.sampleRate}Hz, channels=${s.channelCount}, ` +
          `deviceId=${s.deviceId}`,
      );
    });

    // ----------------------------------------------------------------
    // Watch — Broadcast handles catalog discovery and rendition
    // tracking; Audio.Source picks the active audio rendition;
    // Audio.Decoder runs the WebCodecs decode loop and feeds an
    // AudioWorklet ring buffer; Audio.Emitter routes that to the
    // speakers. `Sync.latencyMax` lets faster-than-real-time TTS build
    // up a buffer instead of the player skipping ahead; `reset()`
    // (invoked on `user-started-speaking`) flushes it on interruption.
    // We also tap Decoder.root → MediaStreamAudioDestinationNode so
    // tracks().bot.audio returns a MediaStreamTrack.
    //
    // `catalogFormat: "hang"` is pinned because the pipecat bot publishes
    // a hang-format catalog (camelCase `sampleRate`). The auto-detector
    // would also land on "hang" here (no suffix on the broadcast name,
    // and hang is the DEFAULT_FORMAT) but pinning removes ambiguity if
    // a future publisher adds a suffix or a different default ships.
    // ----------------------------------------------------------------
    this._watchBroadcast = new Watch.Broadcast({
      connection: this._reload.established,
      enabled: new Signal(true),
      name: new Signal(botPath),
      catalogFormat: new Signal<Watch.CatalogFormat>("hang"),
    });

    // Latency range: floor = interactive jitter buffer (audioLatencyMs),
    // ceiling = how much faster-than-real-time TTS the player will hold
    // before dropping (audioBufferMaxMs). A number-typed max opens the
    // buffer; "real-time" collapses to the floor (skip-ahead behavior).
    const sync = new Watch.Sync({
      connection: this._reload.established,
      latency: new Signal<Watch.Latency>({
        min: merged.audioLatencyMs as Moq.Time.Milli,
        max:
          merged.audioBufferMaxMs === "real-time"
            ? "real-time"
            : (merged.audioBufferMaxMs as Moq.Time.Milli),
      }),
    });
    this._sync = sync;
    this._audioSource = new Watch.Audio.Source(sync, {
      broadcast: this._watchBroadcast,
    });
    this._audioDecoder = new Watch.Audio.Decoder(this._audioSource, {
      enabled: new Signal(true),
    });
    this._audioEmitter = new Watch.Audio.Emitter(this._audioDecoder);

    // Bridge Decoder.root (AudioNode) → MediaStreamTrack for tracks().bot.audio.
    this._signals.run((eff) => {
      const ctx = eff.get(this._audioDecoder!.context);
      const root = eff.get(this._audioDecoder!.root);
      if (!ctx || !root) return;
      const dest = ctx.createMediaStreamDestination();
      root.connect(dest);
      this._botAudioTrack = dest.stream.getAudioTracks()[0];
      eff.cleanup(() => {
        try {
          root.disconnect(dest);
        } catch {
          // best-effort.
        }
        this._botAudioTrack?.stop();
        this._botAudioTrack = undefined;
      });
    });

    // Log the bot's announced audio config + the AudioContext rate we
    // ended up at. If these disagree the voice will play at the wrong
    // pitch — the catalog drives the AudioContext, so a mismatch means
    // either a parser bug or the bot is advertising a rate that doesn't
    // match its actual Opus stream.
    this._signals.run((eff) => {
      const config = eff.get(this._audioSource!.config);
      const ctx = eff.get(this._audioDecoder!.context);
      if (!config && !ctx) return;
      console.log(
        `[MoqTransport] consume: catalog codec=${config?.codec}, ` +
          `catalog sampleRate=${config?.sampleRate}Hz, ` +
          `catalog channels=${config?.numberOfChannels}, ` +
          `AudioContext rate=${ctx?.sampleRate}Hz`,
      );
    });

    // Transcript — snapshot + delta JSON over a single track. We
    // re-subscribe on each (re)connect; @moq/json.Consumer rebuilds the
    // value from each group's snapshot frame and yields per-update.
    this._signals.run((eff) => {
      const conn = eff.get(this._reload!.established);
      if (!conn) return;
      const botBroadcast = conn.consume(botPath);
      const track = botBroadcast.subscribe(merged.transcriptTrack, 0);
      const consumer = new Json.Consumer<RTVIMessage>(track);
      const ac = new AbortController();
      this._drainTranscript(consumer, ac.signal).catch((e) => {
        if (!ac.signal.aborted) {
          console.warn("MoqTransport bot-transcript loop:", e);
        }
      });
      eff.cleanup(() => {
        ac.abort();
        try {
          track.close();
        } catch {
          // best-effort.
        }
      });
    });
  }

  async _disconnect(): Promise<void> {
    if (this._state === "disconnected") return;
    this.state = "disconnecting";
    try {
      this._audioEmitter?.close();
      this._audioDecoder?.close();
      this._audioSource?.close();
      this._sync?.close();
      this._watchBroadcast?.close();
      this._publishBroadcast?.close();
      this._microphone?.close();
      this._signals?.close();
      this._reload?.close();
    } finally {
      this._audioEmitter = null;
      this._audioDecoder = null;
      this._audioSource = null;
      this._sync = null;
      this._watchBroadcast = null;
      this._publishBroadcast = null;
      this._microphone = null;
      this._signals = null;
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
    return this._microphone?.device.available.peek() ?? [];
  }

  async getAllCams(): Promise<MediaDeviceInfo[]> {
    return [];
  }

  async getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    return [];
  }

  updateMic(micId: string): void {
    this._preferredMicId.set(micId);
  }

  updateCam(_camId: string): void {}

  updateSpeaker(_speakerId: string): void {}

  get selectedMic(): MediaDeviceInfo | Record<string, never> {
    const id = this._microphone?.device.active.peek();
    if (!id) return {};
    return (
      this._microphone?.device.available.peek()?.find((d) => d.deviceId === id) ??
      {}
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
    const localSource = this._microphone?.source.peek();
    const localAudio =
      localSource && "track" in localSource ? localSource.track : localSource;
    return {
      local: localAudio ? { audio: localAudio } : {},
      bot: this._botAudioTrack ? { audio: this._botAudioTrack } : {},
    };
  }

  // --------------------------------------------------------------------
  // Internals — transcript
  // --------------------------------------------------------------------

  /** Pull RTVI messages off the @moq/json consumer and hand each one
   *  to `PipecatClient` via `_onMessage`. The handler resolves the
   *  SDK's connect promise when bot-ready arrives. */
  private async _drainTranscript(
    consumer: Json.Consumer<RTVIMessage>,
    signal: AbortSignal,
  ): Promise<void> {
    for (;;) {
      const message = await consumer.next();
      if (!message || signal.aborted) break;
      if (typeof message === "object") {
        // Interruption: the user started talking, so flush the
        // already-buffered TTS for the bot's previous utterance instead
        // of letting it drain. With the bot writing faster than
        // real-time, that buffer can be seconds long.
        if (message.type === "user-started-speaking") {
          this._resetBotAudio();
        }
        this._onMessage?.(message);
      }
    }
  }

  /** Flush buffered bot audio and re-anchor playback at an utterance
   *  boundary. Called on interruption (`user-started-speaking`) so the
   *  already-buffered TTS for the previous utterance stops immediately
   *  instead of draining: re-anchor the sync reference and flush the
   *  decoder's ring buffer. */
  private _resetBotAudio(): void {
    this._sync?.reset();
    this._audioDecoder?.reset();
  }
}
