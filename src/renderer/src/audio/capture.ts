// Mic capture -> 16kHz / 16bit / mono PCM chunks (200ms each) for Volcengine ASR.

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 3200; // 200ms

const WORKLET_SOURCE = `
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${TARGET_RATE};
    this.acc = 0;
    this.buf = new Float32Array(${CHUNK_SAMPLES});
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i += 1) {
      this.acc += 1;
      while (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let s = ch[i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        this.buf[this.offset] = s;
        this.offset += 1;
        if (this.offset === ${CHUNK_SAMPLES}) {
          const out = new Int16Array(${CHUNK_SAMPLES});
          for (let j = 0; j < ${CHUNK_SAMPLES}; j += 1) {
            out[j] = this.buf[j] < 0 ? this.buf[j] * 0x8000 : this.buf[j] * 0x7fff;
          }
          this.port.postMessage(out.buffer, [out.buffer]);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-downsampler', PcmDownsampler);
`;

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  async start(onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const ctx = new AudioContext({ sampleRate: TARGET_RATE });
    this.ctx = ctx;
    const blobUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: 'application/javascript' }),
    );
    await ctx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);

    const node = new AudioWorkletNode(ctx, 'pcm-downsampler');
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onChunk(event.data);
    this.node = node;

    this.source = ctx.createMediaStreamSource(this.stream);
    this.source.connect(node);
    node.connect(ctx.destination);
  }

  stop(): void {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      if (this.node) this.node.port.onmessage = null;
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}
