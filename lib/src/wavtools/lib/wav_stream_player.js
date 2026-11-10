/*!
 * Adapted from openai-realtime-console (https://github.com/openai/openai-realtime-console).
 * Copyright (c) 2024 OpenAI. Modified by Daily. MIT License; see wavtools/index.js.
 */
import { StreamProcessorSrc } from "./worklets/stream_processor.js";
import { AudioAnalysis } from "./analysis/audio_analysis.js";

// Track id given to chunks added without one. Every utterance a caller does
// not tag shares it, so it can never be blacklisted: see getTrackSampleOffset.
const DEFAULT_TRACK_ID = "default";

/**
 * Plays audio streams received in raw PCM16 chunks from the browser
 * @class
 */
export class WavStreamPlayer {
  /**
   * Creates a new WavStreamPlayer instance
   * @param {{sampleRate?: number}} options
   * @returns {WavStreamPlayer}
   */
  constructor({ sampleRate = 44100 } = {}) {
    this.scriptSrc = StreamProcessorSrc;
    this.sampleRate = sampleRate;
    this.context = null;
    this.stream = null;
    this.analyser = null;
    this.trackSampleOffsets = {};
    this.interruptedTrackIds = {};
  }

  /**
   * Connects the audio context and enables output to speakers
   * @returns {Promise<true>}
   */
  async connect() {
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    if (this._speakerID) {
      this.context.setSinkId(this._speakerID);
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    try {
      await this.context.audioWorklet.addModule(this.scriptSrc);
    } catch (e) {
      console.error(e);
      throw new Error(`Could not add audioWorklet module: ${this.scriptSrc}`);
    }
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.1;
    this.analyser = analyser;
    return true;
  }

  /**
   * Gets the current frequency domain data from the playing track
   * @param {"frequency"|"music"|"voice"} [analysisType]
   * @param {number} [minDecibels] default -100
   * @param {number} [maxDecibels] default -30
   * @returns {import('./analysis/audio_analysis.js').AudioAnalysisOutputType}
   */
  getFrequencies(
    analysisType = "frequency",
    minDecibels = -100,
    maxDecibels = -30
  ) {
    if (!this.analyser) {
      throw new Error("Not connected, please call .connect() first");
    }
    return AudioAnalysis.getFrequencies(
      this.analyser,
      this.sampleRate,
      null,
      analysisType,
      minDecibels,
      maxDecibels
    );
  }

  /**
   * @param {string} speaker deviceId
   */
  async updateSpeaker(speaker) {
    const _prevSpeaker = this._speakerID;
    this._speakerID = speaker;
    if (this.context) {
      try {
        if (speaker === "default") {
          await this.context.setSinkId();
        } else {
          await this.context.setSinkId(speaker);
        }
      } catch (e) {
        console.error(`Could not set sinkId to ${speaker}: ${e}`);
        this._speakerID = _prevSpeaker;
      }
    }
  }

  /**
   * Starts audio streaming
   * @private
   * @returns {Promise<true>}
   */
  _start() {
    const streamNode = new AudioWorkletNode(this.context, "stream_processor");
    streamNode.connect(this.context.destination);
    streamNode.port.onmessage = (e) => {
      const { event } = e.data;
      if (event === "stop") {
        streamNode.disconnect();
        // An interrupted stream is dropped before its worklet reports the
        // stop, and a new one may be playing by then. Leave that one alone.
        if (this.stream === streamNode) {
          this.stream = null;
        }
      } else if (event === "offset") {
        const { requestId, trackId, offset } = e.data;
        const currentTime = offset / this.sampleRate;
        this.trackSampleOffsets[requestId] = { trackId, offset, currentTime };
      }
    };
    this.analyser.disconnect();
    streamNode.connect(this.analyser);
    this.stream = streamNode;
    return true;
  }

  /**
   * Adds 16BitPCM data to the currently playing audio stream
   * You can add chunks beyond the current play point and they will be queued for play
   * @param {ArrayBuffer|Int16Array} arrayBuffer
   * @param {string} [trackId] Tag chunks of one utterance with its own id so
   *   that interrupt() can drop the rest of that utterance; untagged chunks
   *   share the default track and always play.
   * @returns {Int16Array|undefined} the samples queued, or undefined when the
   *   track was interrupted and the chunk dropped
   */
  add16BitPCM(arrayBuffer, trackId = DEFAULT_TRACK_ID) {
    if (typeof trackId !== "string") {
      throw new Error(`trackId must be a string`);
    } else if (this.interruptedTrackIds[trackId]) {
      return;
    }
    if (!this.stream) {
      this._start();
    }
    let buffer;
    if (arrayBuffer instanceof Int16Array) {
      buffer = arrayBuffer;
    } else if (arrayBuffer instanceof ArrayBuffer) {
      buffer = new Int16Array(arrayBuffer);
    } else {
      throw new Error(`argument must be Int16Array or ArrayBuffer`);
    }
    this.stream.port.postMessage({ event: "write", buffer, trackId });
    return buffer;
  }

  /**
   * Gets the offset (sample count) of the currently playing stream
   * @param {boolean} [interrupt]
   * @returns {{trackId: string|null, offset: number, currentTime: number}}
   */
  async getTrackSampleOffset(interrupt = false) {
    const stream = this.stream;
    if (!stream) {
      return null;
    }
    const requestId = crypto.randomUUID();
    stream.port.postMessage({
      event: interrupt ? "interrupt" : "offset",
      requestId,
    });
    if (interrupt) {
      // The worklet stops itself on its next render quantum. Let go of the
      // stream now so audio that arrives in the meantime starts a fresh one
      // instead of being written to one that is shutting down.
      this.stream = null;
    }
    let trackSampleOffset;
    while (!trackSampleOffset) {
      trackSampleOffset = this.trackSampleOffsets[requestId];
      await new Promise((r) => setTimeout(() => r(), 1));
    }
    delete this.trackSampleOffsets[requestId];
    const { trackId } = trackSampleOffset;
    // Blacklist the interrupted utterance so chunks of it still in flight
    // are dropped. Only an explicitly tagged track can be: the default
    // track is shared by everything that follows, and blacklisting it would
    // silence the player for good (the list is never cleared).
    if (interrupt && trackId && trackId !== DEFAULT_TRACK_ID) {
      this.interruptedTrackIds[trackId] = true;
    }
    return trackSampleOffset;
  }

  /**
   * Stops the current stream and returns the sample offset of the audio.
   * Chunks added afterwards play on a new stream, except further chunks of
   * an explicitly tagged track that was interrupted, which are dropped.
   * @returns {Promise<{trackId: string|null, offset: number, currentTime: number}|null>}
   */
  async interrupt() {
    return this.getTrackSampleOffset(true);
  }
}

globalThis.WavStreamPlayer = WavStreamPlayer;
