// Compare dev vs packaged sherpa-onnx-node behavior on the same model.
const path = require('node:path');
const fs = require('node:fs');

const which = process.argv[2]; // 'dev' | 'packaged'
const model =
  which === 'packaged'
    ? '/Users/etan330/Desktop/Virgil/release/mac-arm64/Virgil.app/Contents/Resources/vendor/asr/speaker/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'
    : '/Users/etan330/Desktop/Virgil/vendor/asr/speaker/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx';
const base =
  which === 'packaged'
    ? '/Users/etan330/Desktop/Virgil/release/mac-arm64/Virgil.app/Contents/Resources/node_modules'
    : '/Users/etan330/Desktop/Virgil/node_modules';

console.log(`[${which}] model exists:`, fs.existsSync(model));
const sherpa = require(path.join(base, 'sherpa-onnx-node'));
console.log(`[${which}] sherpa loaded, keys:`, Object.keys(sherpa).slice(0, 10));

const ex = new sherpa.SpeakerEmbeddingExtractor({ model, numThreads: 2, debug: 0, provider: 'cpu' });
console.log(`[${which}] extractor ok, dim:`, ex.dim);

// 2s of 440Hz-ish "speech-like" signal
const sr = 16000;
const samples = new Float32Array(sr * 2);
for (let i = 0; i < samples.length; i++) {
  samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr) * (1 + 0.5 * Math.sin((2 * Math.PI * 3 * i) / sr));
}
const stream = ex.createStream();
stream.acceptWaveform({ sampleRate: sr, samples });
stream.inputFinished();
const v = ex.compute(stream, false);
console.log(`[${which}] embedding dim:`, v.length, 'first3:', Array.from(v.slice(0, 3)).map((x) => x.toFixed(4)));
console.log(`[${which}] SUCCESS`);
