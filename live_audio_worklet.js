// AudioWorkletProcessor running inside AudioWorkletGlobalScope (no window/DOM access).
// Downsamples hardware mic audio (44.1kHz / 48kHz / etc.) to 16kHz Int16 PCM frames.

class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._targetRate = 16000;
    this._chunkSamples = 2048; // ~128ms per packet
    this._outBuffer = new Int16Array(this._chunkSamples);
    this._outLen = 0;
    this._srcPos = 0;
    this._energySum = 0;
  }

  process(inputs) {
    const input = inputs && inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const ch = input[0];
    const ratio = sampleRate / this._targetRate;

    while (this._srcPos < ch.length) {
      const idx0 = Math.floor(this._srcPos);
      const idx1 = Math.min(idx0 + 1, ch.length - 1);
      const frac = this._srcPos - idx0;
      const sample = ch[idx0] * (1 - frac) + ch[idx1] * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

      this._outBuffer[this._outLen++] = int16;
      this._energySum += clamped * clamped;

      if (this._outLen >= this._chunkSamples) {
        const rms = Math.sqrt(this._energySum / this._chunkSamples);
        const copy = this._outBuffer.slice(0, this._chunkSamples);
        this.port.postMessage({ type: "pcm", rms, buffer: copy.buffer }, [copy.buffer]);
        this._outLen = 0;
        this._energySum = 0;
      }

      this._srcPos += ratio;
    }
    this._srcPos -= ch.length;
    return true;
  }
}

registerProcessor("pcm16-capture-processor", Pcm16CaptureProcessor);
