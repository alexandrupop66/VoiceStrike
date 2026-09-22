class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noiseGate = true;
    this.openThreshold = 0.008;
    this.closeThreshold = 0.004;
    this.hangoverFrames = 45;
    this.gateOpen = false;
    this.hangover = 0;

    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type !== 'config') return;
      if (typeof data.noiseGate === 'boolean') this.noiseGate = data.noiseGate;
      if (Number.isFinite(data.openThreshold)) this.openThreshold = Number(data.openThreshold);
      if (Number.isFinite(data.closeThreshold)) this.closeThreshold = Number(data.closeThreshold);
      if (Number.isInteger(data.hangoverFrames)) this.hangoverFrames = Number(data.hangoverFrames);
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    let sumSquares = 0;
    for (let i = 0; i < input.length; i++) sumSquares += input[i] * input[i];
    const rms = Math.sqrt(sumSquares / input.length);

    if (this.noiseGate) {
      if (!this.gateOpen && rms >= this.openThreshold) {
        this.gateOpen = true;
        this.hangover = this.hangoverFrames;
      } else if (this.gateOpen) {
        if (rms >= this.closeThreshold) {
          this.hangover = this.hangoverFrames;
        } else if (this.hangover > 0) {
          this.hangover -= 1;
        } else {
          this.gateOpen = false;
        }
      }
    } else {
      this.gateOpen = true;
    }

    const pcm16 = new Int16Array(input.length);
    if (this.gateOpen) {
      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
    }

    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
