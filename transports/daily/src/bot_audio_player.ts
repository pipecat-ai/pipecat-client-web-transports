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

    // Each 128-sample render quantum arrives here as Int16 and is forwarded
    // to WavStreamPlayer, which queues and plays it at the true rate.
    this._captureNode.port.onmessage = (e: MessageEvent) => {
      if (e.data.event === "chunk") {
        this._wavPlayer?.add16BitPCM(e.data.int16 as Int16Array, "bot");
      }
    };

    source.connect(this._captureNode);

    return this._wavPlayer.outputTrack as MediaStreamTrack;
  }

  /** Clear the playback queue, mimicking the avatar stopping mid-speech. */
  async interrupt(): Promise<void> {
    await this._wavPlayer?.interrupt();
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
  }
}
