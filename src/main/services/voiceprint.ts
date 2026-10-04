// Multi-profile voiceprint enrollment and per-utterance speaker identification.
// Uses sherpa-onnx-node's SpeakerEmbeddingExtractor with the 3D-Speaker
// ERes2Net (zh) model bundled in vendor/asr/speaker/.
//
// Storage: userData/voiceprint.json = { profiles: [{ name, vector, enrolledAt }] }.
// Legacy single-vector format migrates to name "我".
//
// Identification (per utterance):
//  1. Best enrolled profile with cos >= ENROLL_THRESHOLD wins -> that name.
//  2. Otherwise the caller may match the vector against *stranger clusters*
//     (see sessionController) so un-enrolled speakers still stay consistent.
//
// Electron >= 21 rejects napi external buffers: compute(stream) throws
// "External buffers are not allowed" — always call compute(stream, false).

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { appendLog } from '../log';

const MODEL_FILE = '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx';
/** min cosine for "this is enrolled speaker X" */
export const VOICEPRINT_THRESHOLD = 0.5;
/** min recording length for enrollment */
export const VOICEPRINT_MIN_SECONDS = 5;

type Embedding = number[];

export interface VoiceprintProfile {
  name: string;
  vector: Embedding;
  enrolledAt: string;
}

interface VoiceprintFile {
  profiles: VoiceprintProfile[];
}

interface ExtractorLike {
  createStream(): {
    acceptWaveform(obj: { sampleRate: number; samples: Float32Array }): void;
    inputFinished(): void;
  };
  /** Second arg disables napi external buffers (required inside Electron >= 21). */
  compute(stream: unknown, enableExternalBuffer?: boolean): Float32Array;
}

let extractor: ExtractorLike | null = null;

function vpLog(message: string): void {
  appendLog('voiceprint.log', `[${new Date().toISOString()}] ${message}\n`);
}

function modelPath(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(root, 'vendor', 'asr', 'speaker', MODEL_FILE);
}

/**
 * sherpa-onnx-node ships platform binaries as a sibling package
 * (sherpa-onnx-darwin-arm64). In the packaged app node_modules lives outside
 * the asar (Contents/Resources/node_modules), so resolve from there.
 */
function loadSherpa(): Record<string, unknown> {
  const base = app.isPackaged
    ? join(process.resourcesPath, 'node_modules')
    : join(app.getAppPath(), 'node_modules');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(join(base, 'sherpa-onnx-node')) as Record<string, unknown>;
}

function getExtractor(): ExtractorLike | null {
  if (extractor) return extractor;
  try {
    const model = modelPath();
    vpLog(`loading model: ${model}, exists=${existsSync(model)}`);
    const sherpa = loadSherpa() as {
      SpeakerEmbeddingExtractor: new (cfg: Record<string, unknown>) => ExtractorLike;
    };
    extractor = new sherpa.SpeakerEmbeddingExtractor({
      model,
      numThreads: 2,
      debug: 0,
      provider: 'cpu',
    });
    vpLog('extractor initialized');
    return extractor;
  } catch (err) {
    vpLog(`init failed: ${(err as Error).message}`);
    console.error('[voiceprint] init failed:', (err as Error).message);
    return null;
  }
}

function int16ToFloat(pcm: Buffer): Float32Array {
  const n = Math.floor(pcm.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = pcm.readInt16LE(i * 2) / 32768;
  return out;
}

export function cosine(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

function embedPcm(pcm: Buffer): Embedding | null {
  const ex = getExtractor();
  if (!ex) {
    vpLog('embedPcm: extractor not ready');
    return null;
  }
  try {
    const stream = ex.createStream();
    const samples = int16ToFloat(pcm);
    stream.acceptWaveform({ sampleRate: 16000, samples });
    stream.inputFinished();
    const vector = Array.from(ex.compute(stream, false));
    vpLog(`embedPcm: extracted dim=${vector.length}`);
    return vector;
  } catch (err) {
    vpLog(`embed failed: ${(err as Error).message}`);
    console.error('[voiceprint] embed failed:', (err as Error).message);
    return null;
  }
}

function file(): string {
  return join(app.getPath('userData'), 'voiceprint.json');
}

function readProfiles(): VoiceprintProfile[] {
  if (!existsSync(file())) return [];
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<VoiceprintFile> & {
      vector?: Embedding;
    };
    // Legacy single-profile format -> treat as "我".
    if (Array.isArray(raw.profiles)) return raw.profiles;
    if (raw.vector) return [{ name: '我', vector: raw.vector, enrolledAt: new Date().toISOString() }];
    return [];
  } catch {
    return [];
  }
}

function writeProfiles(profiles: VoiceprintProfile[]): void {
  writeFileSync(file(), JSON.stringify({ profiles } satisfies VoiceprintFile), 'utf8');
}

export function listVoiceprints(): Array<{ name: string; enrolledAt: string }> {
  return readProfiles().map(({ name, enrolledAt }) => ({ name, enrolledAt }));
}

export function voiceprintEnrolled(): boolean {
  return readProfiles().length > 0;
}

export function enrollVoiceprint(
  name: string,
  pcm: Buffer,
): { ok: boolean; message: string; enrolled: boolean } {
  const seconds = pcm.byteLength / (16000 * 2);
  vpLog(`enroll requested: name="${name}", ${seconds.toFixed(2)}s, bytes=${pcm.byteLength}`);
  const cleanName = name.trim().slice(0, 20);
  if (!cleanName) return { ok: false, message: '请先填写说话人名字', enrolled: voiceprintEnrolled() };
  if (seconds < VOICEPRINT_MIN_SECONDS) {
    return {
      ok: false,
      message: `录音太短（${seconds.toFixed(1)} 秒），请连续读满 ${VOICEPRINT_MIN_SECONDS} 秒`,
      enrolled: voiceprintEnrolled(),
    };
  }
  // Silence guard: an empty room must never produce a "voiceprint".
  const samples = pcm.length >> 1;
  let sumSquares = 0;
  for (let i = 0; i < samples; i += 1) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples));
  if (rms < 0.01) {
    vpLog(`enroll rejected: silence (rms=${rms.toFixed(4)})`);
    return {
      ok: false,
      message: '没有检测到你的声音，请对着麦克风大声读出引导句再试',
      enrolled: voiceprintEnrolled(),
    };
  }
  const vector = embedPcm(pcm);
  if (!vector) {
    vpLog('enroll failed: embedPcm returned null');
    return { ok: false, message: '声纹提取失败（模型未就绪？）', enrolled: voiceprintEnrolled() };
  }
  const profiles = readProfiles().filter((p) => p.name !== cleanName);
  profiles.push({ name: cleanName, vector, enrolledAt: new Date().toISOString() });
  writeProfiles(profiles);
  vpLog(`enroll success: name="${cleanName}", total profiles=${profiles.length}`);
  return { ok: true, message: `「${cleanName}」声纹登记成功`, enrolled: true };
}

export function deleteVoiceprint(name?: string): boolean {
  if (!name) {
    try {
      unlinkSync(file());
    } catch {
      /* not enrolled */
    }
    return false;
  }
  const profiles = readProfiles().filter((p) => p.name !== name);
  writeProfiles(profiles);
  return profiles.length > 0;
}

export interface IdentifyResult {
  /** Matched enrolled profile name. */
  name: string;
  score: number;
}

/** Embed one utterance. Null when too short (<1s embeds poorly) or model unavailable. */
export function embedUtterance(pcm: Buffer): Embedding | null {
  const seconds = pcm.byteLength / (16000 * 2);
  if (seconds < 1.0) {
    vpLog(`embedUtterance: too short (${seconds.toFixed(2)}s)`);
    return null;
  }
  return embedPcm(pcm);
}

/** Match a pre-computed embedding against enrolled profiles. */
export function matchEnrolled(vector: Embedding): IdentifyResult | null {
  const profiles = readProfiles();
  if (profiles.length === 0) return null;
  let best: VoiceprintProfile | null = null;
  let bestScore = -1;
  for (const p of profiles) {
    const score = cosine(vector, p.vector);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best || bestScore < VOICEPRINT_THRESHOLD) {
    vpLog(`identify: no enrolled match (best=${best?.name ?? 'none'} score=${bestScore.toFixed(3)})`);
    return null;
  }
  vpLog(`identify: "${best.name}" score=${bestScore.toFixed(3)}`);
  return { name: best.name, score: bestScore };
}

/**
 * Match one utterance against enrolled profiles.
 * Returns the best profile when cos >= VOICEPRINT_THRESHOLD, else null
 * (caller decides what to do with un-matched audio).
 */
export function identifyVoice(pcm: Buffer): IdentifyResult | null {
  if (readProfiles().length === 0) return null;
  const vector = embedUtterance(pcm);
  if (!vector) return null;
  return matchEnrolled(vector);
}
