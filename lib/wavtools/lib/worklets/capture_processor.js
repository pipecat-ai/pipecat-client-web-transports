const CaptureProcessorWorklet = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._active = true;
    this.port.onmessage = (e) => {
      if (e.data.event === 'stop') {
        this._active = false;
      }
    };
  }

  process(inputs) {
    if (!this._active) return false;
    const ch = inputs[0]?.[0];
    if (ch?.length) {
      const int16 = new Int16Array(ch.length);
      let maxAbs = 0;
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        const abs = Math.abs(int16[i]);
        if (abs > maxAbs) maxAbs = abs;
      }
      // WebRTC injects all-zero silence between speech bursts; threshold 5
      // matches the Python-side _is_silence() check.
      const isSilent = maxAbs < 5;
      // Transfer the buffer to avoid a copy
      this.port.postMessage({ event: 'chunk', int16, isSilent }, [int16.buffer]);
    }
    return true;
  }
}

registerProcessor('capture_processor', CaptureProcessor);
`;

const script = new Blob([CaptureProcessorWorklet], {
  type: "application/javascript",
});
const src = URL.createObjectURL(script);
export const CaptureProcessorSrc = src;
