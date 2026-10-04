import { app } from 'electron';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CopilotCard,
  SessionMeta,
  SessionRecord,
  TranscriptSegment,
} from '../../shared/types';

function sessionsDir(): string {
  const dir = join(app.getPath('userData'), 'sessions');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionDir(id: string): string {
  const dir = join(sessionsDir(), id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function metaPath(id: string): string {
  return join(sessionDir(id), 'session.json');
}

function transcriptPath(id: string): string {
  return join(sessionDir(id), 'transcript.ndjson');
}

function audioPath(id: string): string {
  return join(sessionDir(id), 'audio.wav');
}

export function sessionAudioPath(id: string): string | null {
  // Guard: an empty id resolves to the sessions dir itself, which would be
  // handed to the History player as if it were a wav file.
  if (!id) return null;
  const p = audioPath(id);
  return existsSync(p) ? p : null;
}

/**
 * Raw 16k/16bit/mono PCM capture. Header is written with placeholder sizes
 * and patched when the recording is finished.
 */
export function startAudio(id: string): void {
  if (!id) return;
  const fd = openSync(audioPath(id), 'w');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36, 4); // patched on finish
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); // byte rate
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(0, 40); // patched on finish
  writeSync(fd, header);
  closeSync(fd);
}

/** Appends one PCM chunk; returns total audio duration in ms so far. */
export function appendAudio(id: string, pcm: Buffer): number {
  if (!id) return 0;
  const p = audioPath(id);
  if (!existsSync(p)) return 0;
  const sizeBefore = statSync(p).size;
  const fd = openSync(p, 'a');
  writeSync(fd, pcm);
  closeSync(fd);
  // (sizeBefore - 44) bytes of audio = 2 bytes per sample at 16 kHz.
  return Math.round(((sizeBefore - 44) + pcm.byteLength) / 32); // 32000 bytes/sec -> ms
}

/**
 * Writes a silent 16k/16bit/mono wav of the given length.
 * Demo sessions have no microphone input, but they must still look and behave
 * exactly like a recorded one in History: player, duration, and
 * click-a-transcript-line-to-seek all need a real file to work against.
 */
export function writeSilentWav(id: string, durationMs: number): void {
  if (!id) return;
  const dataBytes = Math.max(0, Math.floor((durationMs / 1000) * 32000));
  const aligned = dataBytes - (dataBytes % 2); // 16bit frames
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + aligned, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); // byte rate
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(aligned, 40);
  const fd = openSync(audioPath(id), 'w');
  writeSync(fd, header);
  writeSync(fd, Buffer.alloc(aligned)); // silence
  closeSync(fd);
}

/** Patches the RIFF/data sizes to finalize a valid wav file. */
export function finishAudio(id: string): void {
  if (!id) return;
  const p = audioPath(id);
  if (!existsSync(p)) return;
  const total = statSync(p).size;
  const fd = openSync(p, 'r+');
  const b4 = Buffer.alloc(4);
  b4.writeUInt32LE(total - 8, 0);
  writeSync(fd, b4, 0, 4, 4); // RIFF chunk size
  b4.writeUInt32LE(total - 44, 0);
  writeSync(fd, b4, 0, 4, 40); // data chunk size
  closeSync(fd);
}

/** One-off repair: restores the WAVE magic clobbered by the old finishAudio. */
export function repairWavHeader(id: string): void {
  if (!id) return;
  const p = audioPath(id);
  if (!existsSync(p)) return;
  const fd = openSync(p, 'r+');
  writeSync(fd, Buffer.from('WAVE', 'ascii'), 0, 4, 8);
  closeSync(fd);
}

function defaultTitle(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `会话 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function createSession(title?: string): SessionMeta {
  const meta: SessionMeta = {
    id: randomUUID(),
    title: title?.trim() || defaultTitle(),
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_ms: 0,
  };
  writeSession({ meta, summary: [], transcript: [], cards: [], audioPath: null });
  return meta;
}

/** Transcript lives in NDJSON only; session.json stores metadata + summary + cards. */
export function writeSession(record: SessionRecord): void {
  writeFileSync(
    metaPath(record.meta.id),
    JSON.stringify({ ...record, transcript: [] }, null, 2),
    'utf8',
  );
}

export function appendSegments(id: string, segments: TranscriptSegment[]): void {
  // With an empty id the file would land in the sessions root and belong to
  // no session at all, so refuse instead of scattering data.
  if (!id || segments.length === 0) return;
  const lines = segments.map((s) => JSON.stringify(s)).join('\n') + '\n';
  appendFileSync(transcriptPath(id), lines, 'utf8');
}

export function readSegments(id: string): TranscriptSegment[] {
  if (!id) return [];
  const file = transcriptPath(id);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line) as TranscriptSegment;
      } catch {
        return null;
      }
    })
    .filter((s): s is TranscriptSegment => s !== null)
    .map((s, i) => ({ ...s, idx: s.idx ?? i }));
}

export function finishSession(id: string, durationMs: number): SessionMeta | null {
  if (!id) return null;
  const record = loadSession(id);
  if (!record) return null;
  record.meta.ended_at = new Date().toISOString();
  record.meta.duration_ms = durationMs;
  writeSession(record);
  return record.meta;
}

export function loadSession(id: string): SessionRecord | null {
  if (!id) return null;
  const file = metaPath(id);
  if (!existsSync(file)) return null;
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as SessionRecord;
    record.transcript = readSegments(id);
    record.summary = record.summary ?? [];
    record.cards = record.cards ?? [];
    record.audioPath = sessionAudioPath(id);
    return record;
  } catch {
    return null;
  }
}

function readMetaOnly(id: string): SessionMeta | null {
  if (!id) return null;
  const file = metaPath(id);
  if (!existsSync(file)) return null;
  try {
    const head = JSON.parse(readFileSync(file, 'utf8')) as SessionRecord;
    return head.meta ?? null;
  } catch {
    return null;
  }
}

export function listSessions(): SessionMeta[] {
  const dir = sessionsDir();
  return readdirSync(dir)
    .map((id) => readMetaOnly(id))
    .filter((m): m is SessionMeta => m !== null)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
}

export function renameSession(id: string, title: string): SessionMeta | null {
  if (!id) return null;
  const record = loadSession(id);
  if (!record) return null;
  record.meta.title = title.trim() || record.meta.title;
  writeSession(record);
  return record.meta;
}

/** Auto-title (ChatGPT style). Only fills in when the title is still the default. */
export function setTitleIfDefault(id: string, title: string): SessionMeta | null {
  if (!id) return null;
  const record = loadSession(id);
  if (!record) return null;
  if (!record.meta.title.startsWith('会话 ')) return record.meta; // user already renamed
  record.meta.title = title.trim().slice(0, 24) || record.meta.title;
  writeSession(record);
  return record.meta;
}

export interface SearchHit {
  meta: SessionMeta;
  /** Which part matched. */
  field: '标题' | '转录' | '总结' | 'Copilot';
  snippet: string;
}

/** Full-text search across title / transcript / summary / copilot cards. */
export function searchSessions(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const meta of listSessions()) {
    const record = loadSession(meta.id);
    if (!record) continue;
    if (meta.title.toLowerCase().includes(q)) {
      hits.push({ meta, field: '标题', snippet: meta.title });
      continue; // one hit per session is enough when the title matches
    }
    const line = (text: string) =>
      text.toLowerCase().includes(q)
        ? text.slice(Math.max(0, text.toLowerCase().indexOf(q) - 20), 120)
        : null;
    for (const seg of record.transcript) {
      const snip = line(seg.text);
      if (snip) {
        hits.push({ meta, field: '转录', snippet: snip });
        break;
      }
    }
    if (hits.at(-1)?.meta.id === meta.id) continue;
    for (const s of record.summary) {
      const snip = line(s);
      if (snip) {
        hits.push({ meta, field: '总结', snippet: snip });
        break;
      }
    }
    if (hits.at(-1)?.meta.id === meta.id) continue;
    for (const card of record.cards) {
      const snip = line(`${card.title} ${card.suggested_text}`);
      if (snip) {
        hits.push({ meta, field: 'Copilot', snippet: snip });
        break;
      }
    }
  }
  return hits;
}

/** Permanently removes a session (metadata + transcript). Irreversible. */
export function deleteSession(id: string): boolean {
  if (!id) return false;
  const dir = join(sessionsDir(), id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function updateCards(id: string, cards: CopilotCard[], summary: string[]): void {
  if (!id) return;
  const record = loadSession(id);
  if (!record) return;
  record.cards = cards;
  record.summary = summary;
  writeSession(record);
}
