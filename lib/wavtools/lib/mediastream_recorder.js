import { AudioProcessorSrc } from "./worklets/audio_processor.js";
import { AudioAnalysis } from "./analysis/audio_analysis.js";
import { WavPacker } from "./wav_packer.js";

/**
 * Resamples audio data from one sample rate to another using linear interpolation
 * @param {ArrayBuffer} inputBuffer - Input audio data as Int16 PCM
 * @param {number} inputSampleRate - Sample rate of input audio
 * @param {number} outputSampleRate - Desired output sample rate
 * @returns {ArrayBuffer} - Resampled audio data as Int16 PCM
 */
function resampleAudioBuffer(inputBuffer, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return inputBuffer;
  }

  const inputView = new Int16Array(inputBuffer);
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(inputView.length / ratio);
  const outputBuffer = new ArrayBuffer(outputLength * 2);
  const outputView = new Int16Array(outputBuffer);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputView.length - 1);
    const t = srcIndex - srcIndexFloor;

    // Linear interpolation
    outputView[i] = Math.round(
      inputView[srcIndexFloor] * (1 - t) + inputView[srcIndexCeil] * t,
    );
  }

  return outputBuffer;
}

/**
 * Decodes audio into a wav file
 * @typedef {Object} DecodedAudioType
 * @property {Blob} blob
 * @property {string} url
 * @property {Float32Array} values
 * @property {AudioBuffer} audioBuffer
 */

/**
 * Records live stream of user audio as PCM16 "audio/wav" data
 * @class
 */
export class MediaStreamRecorder {
  /**
   * Create a new MediaStreamRecorder instance
   * @param {{sampleRate?: number, outputToSpeakers?: boolean, debug?: boolean}} [options]
   * @returns {MediaStreamRecorder}
   */
  constructor({
    sampleRate = 44100,
    outputToSpeakers = false,
    debug = false,
  } = {}) {
    // Script source
    this.scriptSrc = AudioProcessorSrc;
    // Config
    this.sampleRate = sampleRate;
    this.outputToSpeakers = outputToSpeakers;
    this.debug = !!debug;
    // State variables
    this.stream = null;
    this.processor = null;
    this.source = null;
    this.node = null;
    this.recording = false;
    // Event handling with AudioWorklet
    this._lastEventId = 0;
    this.eventReceipts = {};
    this.eventTimeout = 5000;
    // Process chunks of audio
    this._chunkProcessor = () => {};
    this._chunkProcessorSize = void 0;
    this._chunkProcessorBuffer = {
      raw: new ArrayBuffer(0),
      mono: new ArrayBuffer(0),
    };
  }

  /**
   * Logs data in debug mode
   * @param {...any} arguments
   * @returns {true}
   */
  log() {
    if (this.debug) {
      this.log(...arguments);
    }
    return true;
  }

  /**
   * Retrieves the current sampleRate for the recorder
   * @returns {number}
   */
  getSampleRate() {
    return this.sampleRate;
  }

  /**
   * Retrieves the current status of the recording
   * @returns {"ended"|"paused"|"recording"}
   */
  getStatus() {
    if (!this.processor) {
      return "ended";
    } else if (!this.recording) {
      return "paused";
    } else {
      return "recording";
    }
  }

  /**
   * Sends an event to the AudioWorklet
   * @private
   * @param {string} name
   * @param {{[key: string]: any}} data
   * @param {AudioWorkletNode} [_processor]
   * @returns {Promise<{[key: string]: any}>}
   */
  async _event(name, data = {}, _processor = null) {
    _processor = _processor || this.processor;
    if (!_processor) {
      throw new Error("Can not send events without recording first");
    }
    const message = {
      event: name,
      id: this._lastEventId++,
      data,
    };
    _processor.port.postMessage(message);
    const t0 = new Date().valueOf();
    while (!this.eventReceipts[message.id]) {
      if (new Date().valueOf() - t0 > this.eventTimeout) {
        throw new Error(`Timeout waiting for "${name}" event`);
      }
      await new Promise((res) => setTimeout(() => res(true), 1));
    }
    const payload = this.eventReceipts[message.id];
    delete this.eventReceipts[message.id];
    return payload;
  }

  /**
   * Begins a recording session for the given audioTrack
   * Microphone recording indicator will appear on browser tab but status will be "paused"
   * @param {MediaStreamTrack} [audioTrack] if no device provided, default device will be used
   * @returns {Promise<true>}
   */
  async begin(audioTrack) {
    if (this.processor) {
      throw new Error(
        `Already connected: please call .end() to start a new session`,
      );
    }

    if (!audioTrack || audioTrack.kind !== "audio") {
      throw new Error("No audio track provided");
    }

    this.stream = new MediaStream([audioTrack]);

    // Firefox workaround: Firefox doesn't support connecting AudioNodes from
    // AudioContexts with different sample rates. So we create the AudioContext
    // at the native sample rate and resample manually.
    // This workaround may be temporary; Firefox is in the process of adding
    // support for this.
    // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1674892
    const isFirefox = navigator.userAgent.toLowerCase().includes("firefox");

    let context;
    if (isFirefox) {
      // Firefox: Use native sample rate and resample manually
      context = new AudioContext();
    } else {
      // Other browsers: Let the AudioContext handle resampling
      context = new AudioContext({ sampleRate: this.sampleRate });
    }
    const contextSampleRate = context.sampleRate;

    const source = context.createMediaStreamSource(this.stream);
    // Load and execute the module script.
    try {
      await context.audioWorklet.addModule(this.scriptSrc);
    } catch (e) {
      console.error(e);
      throw new Error(`Could not add audioWorklet module: ${this.scriptSrc}`);
    }
    const processor = new AudioWorkletNode(context, "audio_processor");
    processor.port.onmessage = (e) => {
      const { event, id, data } = e.data;
      if (event === "receipt") {
        this.eventReceipts[id] = data;
      } else if (event === "chunk") {
        // Resample chunk data from native sample rate to target sample rate
        // (no-op if rates match, i.e. for non-Firefox browsers)
        const resampledData = {
          raw: resampleAudioBuffer(
            data.raw,
            contextSampleRate,
            this.sampleRate,
          ),
          mono: resampleAudioBuffer(
            data.mono,
            contextSampleRate,
            this.sampleRate,
          ),
        };

        if (this._chunkProcessorSize) {
          const buffer = this._chunkProcessorBuffer;
          this._chunkProcessorBuffer = {
            raw: WavPacker.mergeBuffers(buffer.raw, resampledData.raw),
            mono: WavPacker.mergeBuffers(buffer.mono, resampledData.mono),
          };
          if (
            this._chunkProcessorBuffer.mono.byteLength >=
            this._chunkProcessorSize
          ) {
            this._chunkProcessor(this._chunkProcessorBuffer);
            this._chunkProcessorBuffer = {
              raw: new ArrayBuffer(0),
              mono: new ArrayBuffer(0),
            };
          }
        } else {
          this._chunkProcessor(resampledData);
        }
      }
    };

    const node = source.connect(processor);
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.1;
    node.connect(analyser);
    if (this.outputToSpeakers) {
      // eslint-disable-next-line no-console
      console.warn(
        "Warning: Output to speakers may affect sound quality,\n" +
          "especially due to system audio feedback preventative measures.\n" +
          "use only for debugging",
      );
      analyser.connect(context.destination);
    }

    this.source = source;
    this.node = node;
    this.analyser = analyser;
    this.processor = processor;
    return true;
  }

  /**
   * Gets the current frequency domain data from the recording track
   * @param {"frequency"|"music"|"voice"} [analysisType]
   * @param {number} [minDecibels] default -100
   * @param {number} [maxDecibels] default -30
   * @returns {import('./analysis/audio_analysis.js').AudioAnalysisOutputType}
   */
  getFrequencies(
    analysisType = "frequency",
    minDecibels = -100,
    maxDecibels = -30,
  ) {
    if (!this.processor) {
      throw new Error("Session ended: please call .begin() first");
    }
    return AudioAnalysis.getFrequencies(
      this.analyser,
      this.sampleRate,
      null,
      analysisType,
      minDecibels,
      maxDecibels,
    );
  }

  /**
   * Pauses the recording
   * Keeps microphone stream open but halts storage of audio
   * @returns {Promise<true>}
   */
  async pause() {
    if (!this.processor) {
      throw new Error("Session ended: please call .begin() first");
    } else if (!this.recording) {
      throw new Error("Already paused: please call .record() first");
    }
    if (this._chunkProcessorBuffer.raw.byteLength) {
      this._chunkProcessor(this._chunkProcessorBuffer);
    }
    this.log("Pausing ...");
    await this._event("stop");
    this.recording = false;
    return true;
  }

  /**
   * Start recording stream and storing to memory from the connected audio source
   * @param {(data: { mono: Int16Array; raw: Int16Array }) => any} [chunkProcessor]
   * @param {number} [chunkSize] chunkProcessor will not be triggered until this size threshold met in mono audio
   * @returns {Promise<true>}
   */
  async record(chunkProcessor = () => {}, chunkSize = 8192) {
    if (!this.processor) {
      throw new Error("Session ended: please call .begin() first");
    } else if (this.recording) {
      throw new Error("Already recording: HELLO please call .pause() first");
    } else if (typeof chunkProcessor !== "function") {
      throw new Error(`chunkProcessor must be a function`);
    }
    this._chunkProcessor = chunkProcessor;
    this._chunkProcessorSize = chunkSize;
    this._chunkProcessorBuffer = {
      raw: new ArrayBuffer(0),
      mono: new ArrayBuffer(0),
    };
    this.log("Recording ...");
    await this._event("start");
    this.recording = true;
    return true;
  }

  /**
   * Clears the audio buffer, empties stored recording
   * @returns {Promise<true>}
   */
  async clear() {
    if (!this.processor) {
      throw new Error("Session ended: please call .begin() first");
    }
    await this._event("clear");
    return true;
  }

  /**
   * Reads the current audio stream data
   * @returns {Promise<{meanValues: Float32Array, channels: Array<Float32Array>}>}
   */
  async read() {
    if (!this.processor) {
      throw new Error("Session ended: please call .begin() first");
    }
    this.log("Reading ...");
    const result = await this._event("read");
    return result;
  }

  /**
   * Saves the current audio stream to a file
   * @param {boolean} [force] Force saving while still recording
   * @returns {Promise<import('./wav_packer.js').WavPackerAudioType>}
   */
  async save(force = false) {
    if (!this.processor) {
      throw new Error("Session ended: please call .begin() first");
    }
    if (!force && this.recording) {
      throw new Error(
        "Currently recording: please call .pause() first, or call .save(true) to force",
      );
    }
    this.log("Exporting ...");
    const exportData = await this._event("export");
    const packer = new WavPacker();
    const result = packer.pack(this.sampleRate, exportData.audio);
    return result;
  }

  /**
   * Ends the current recording session and saves the result
   * @returns {Promise<import('./wav_packer.js').WavPackerAudioType>}
   */
  async end() {
    if (!this.processor) {
      throw new Error("Session ended: please call .begin() first");
    }

    const _processor = this.processor;

    this.log("Stopping ...");
    await this._event("stop");
    this.recording = false;

    this.log("Exporting ...");
    const exportData = await this._event("export", {}, _processor);

    this.processor.disconnect();
    this.source.disconnect();
    this.node.disconnect();
    this.analyser.disconnect();
    this.stream = null;
    this.processor = null;
    this.source = null;
    this.node = null;

    const packer = new WavPacker();
    const result = packer.pack(this.sampleRate, exportData.audio);
    return result;
  }

  /**
   * Performs a full cleanup of WavRecorder instance
   * Stops actively listening via microphone and removes existing listeners
   * @returns {Promise<true>}
   */
  async quit() {
    this.listenForDeviceChange(null);
    if (this.processor) {
      await this.end();
    }
    return true;
  }
}

globalThis.WavRecorder = WavRecorder;
