// AudioWorklet that hands microphone samples to the main thread in blocks of 512,
// stamped with the audio-clock time of the block's last sample.
class UkeTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(512);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === 512) {
          this.port.postMessage({ t: currentTime + i / sampleRate, s: this.buf }, [this.buf.buffer]);
          this.buf = new Float32Array(512);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("uke-tap", UkeTap);
