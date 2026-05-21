import { WavStreamPlayer } from "../../../lib/wavtools";
import { CaptureProcessorSrc } from "../../../lib/wavtools";

/**
 * Plays bot audio delivered faster-than-realtime over WebRTC.
 *
 * Pipecat writes true-rate PCM (e.g. 24 kHz) into a CustomAudioSource
 * declared at a higher rate (e.g. 48 kHz), so audio arrives ~2x faster than
 * real-time. This class captures that track at the declared rate, converts
 * each render quantum to Int16 via an AudioWorklet, and feeds the samples
 * into WavStreamPlayer whose AudioContext runs at the true rate — producing
 * a correctly-pitched MediaStreamTrack that can be played normally.
 */
export class BotAudioPlayer {
  private _captureCtx: AudioContext | null = null;
  private _captureNode: AudioWorkletNode | null = null;
  private _wavPlayer: InstanceType<typeof WavStreamPlayer> | null = null;
  private _activationElement: HTMLAudioElement | null = null;

  // Buffer tracking for silence-skip logic (mirrors Python _buffer_audio logic).
  private _trueRate = 0;
  private _minBufferSamples = 0; // 100 ms pre-buffer at true rate
  private _totalSamplesAdded = 0;
  private _playbackStartTime: number | null = null;
  private _lastLogTime: number | null = null;

  /**
   * Start capturing and playing the bot's audio track.
   *
   * @param track           The bot's MediaStreamTrack from Daily (declared at declaredRate).
   * @param declaredRate    The sample rate Pipecat declared to the CustomAudioSource (e.g. 48000).
   * @param trueRate        The actual content sample rate of the audio (e.g. 24000).
   * @returns               A MediaStreamTrack at trueRate with correctly-pitched audio.
   */
  async start(
    track: MediaStreamTrack,
    declaredRate: number,
    trueRate: number
  ): Promise<MediaStreamTrack> {
    // Chrome's WebRTC audio pipeline is dormant until the track is rendered in
    // an <audio> element. Without this, createMediaStreamSource() receives
    // silence. We attach the original track to a silent element to activate the
    // pipeline without any audible output.
    this._activationElement = new Audio();
    this._activationElement.srcObject = new MediaStream([track]);
    this._activationElement.volume = 0;
    await this._activationElement.play().catch(() => {});

    this._trueRate = trueRate;
    this._minBufferSamples = Math.ceil(trueRate * 0.1); // 100 ms pre-buffer
    this._totalSamplesAdded = 0;
    this._playbackStartTime = null;
    this._lastLogTime = null;

    // Playback context at true rate. outputToSpeakers:false so audio only
    // flows to outputTrack — the caller's <audio> element plays it, avoiding
    // double playback from both context.destination and the audio element.
    this._wavPlayer = new WavStreamPlayer({ sampleRate: trueRate, outputToSpeakers: false });
    await this._wavPlayer.connect();

    // Capture context at declared rate. sinkId:{type:'none'} prevents any
    // audio from reaching the speakers from this context.
    this._captureCtx = new AudioContext({
      sampleRate: declaredRate,
      // @ts-expect-error -- sinkId is not in all TypeScript lib versions yet
      sinkId: { type: "none" },
    });
    await this._captureCtx.audioWorklet.addModule(CaptureProcessorSrc);

    const source = this._captureCtx.createMediaStreamSource(
      new MediaStream([track])
    );
    this._captureNode = new AudioWorkletNode(
      this._captureCtx,
      "capture_processor"
    );

    // Each 128-sample render quantum arrives here as Int16. Silence frames
    // injected by WebRTC are discarded when the buffer is healthy so they don't
    // accumulate faster than the drain rate (speech arrives at 2x speed, so
    // silence queues at 2x speed too). Below the pre-buffer threshold we keep
    // silence so playback can start smoothly — mirrors Python _buffer_audio().
    this._captureNode.port.onmessage = (e: MessageEvent) => {
      if (e.data.event === "chunk") {
        const int16 = e.data.int16 as Int16Array;
        const isSilent = e.data.isSilent as boolean;

        if (isSilent) {
          const buffered = this._estimatedBufferedSamples();
          if (buffered >= this._minBufferSamples) {
            this._maybeLogBufferStatus();
            return; // buffer is healthy — discard silence so it can drain
          }
          // buffer is below pre-buffer threshold — keep silence to fill it
        }

        // Reset tracking when WavStreamPlayer drained and restarted between utterances.
        if (!this._wavPlayer?.stream) {
          this._totalSamplesAdded = 0;
          this._playbackStartTime = null;
        }
        if (this._playbackStartTime === null) {
          this._playbackStartTime = performance.now();
        }
        this._totalSamplesAdded += int16.length;
        this._wavPlayer?.add16BitPCM(int16, "bot");
        this._maybeLogBufferStatus();
      }
    };

    source.connect(this._captureNode);

    return this._wavPlayer.outputTrack as MediaStreamTrack;
  }

  /** Clear the playback queue, mimicking the avatar stopping mid-speech. */
  async interrupt(): Promise<void> {
    const dropped = this._estimatedBufferedSamples();
    if (dropped > 0) {
      console.log(
        `[BotAudioPlayer] Interrupt — dropped ~${dropped.toFixed(0)} samples (${(dropped / this._trueRate).toFixed(3)}s)`
      );
    }
    this._totalSamplesAdded = 0;
    this._playbackStartTime = null;
    await this._wavPlayer?.interrupt();
  }

  private _estimatedBufferedSamples(): number {
    if (this._playbackStartTime === null || this._totalSamplesAdded === 0) return 0;
    const elapsedMs = performance.now() - this._playbackStartTime;
    const drained = (elapsedMs / 1000) * this._trueRate;
    return Math.max(0, this._totalSamplesAdded - drained);
  }

  private _maybeLogBufferStatus(): void {
    const now = performance.now();
    if (this._lastLogTime === null || now - this._lastLogTime >= 1000) {
      const buffered = this._estimatedBufferedSamples();
      const bufferedSeconds = buffered / this._trueRate;
      console.log(
        `[BotAudioPlayer] Buffer: ~${buffered.toFixed(0)} samples (${bufferedSeconds.toFixed(3)}s)`
      );
      this._lastLogTime = now;
    }
  }

  /** Tear down both audio contexts and release all resources. */
  async stop(): Promise<void> {
    if (this._activationElement) {
      this._activationElement.pause();
      this._activationElement.srcObject = null;
      this._activationElement = null;
    }
    this._captureNode?.port.postMessage({ event: "stop" });
    this._captureNode?.disconnect();
    await this._captureCtx?.close();
    this._captureCtx = null;
    this._captureNode = null;
    this._wavPlayer = null;
    this._totalSamplesAdded = 0;
    this._playbackStartTime = null;
  }
}
