import { randomUUID } from 'node:crypto';
import type {
  CopilotCard,
  LiveSnapshot,
  ServiceStatus,
  Settings,
  TranscriptSegment,
} from '../shared/types';
import { activeTextConfig, hasAiKey } from './store/settings';
import {
  appendAudio,
  appendSegments,
  createSession,
  finishAudio,
  finishSession,
  setTitleIfDefault,
  startAudio,
  updateCards,
  writeSilentWav,
} from './store/sessions';
import { VolcAsrService } from './services/asr';
import { MockAsrDriver } from './services/mockAsr';
import {
  DeepSeekAiService,
  MockAiService,
  generateTitle,
  type AiLike,
} from './services/ai';
import { DEMO_TITLE } from './services/demoScript';
import { cosine, embedUtterance, matchEnrolled } from './services/voiceprint';

const AI_DEBOUNCE_MS = 2500;
const AI_PERIODIC_MS = 25_000;
const TRANSCRIPT_WINDOW_CHARS = 8000;
/**
 * Upper bound on how long End waits for the wrap-up AI pass. The live path
 * retries 3x with backoff (worst case ~90s); blocking End on that looks like a
 * freeze, so the final pass is cut off and whatever summary we already have is
 * kept.
 */
const FINAL_ANALYZE_TIMEOUT_MS = 10_000;
/**
 * Cap on the PCM buffered for the utterance being spoken. It is only drained
 * when the ASR emits a final result — if the stream stalls (network drop) the
 * buffer would otherwise grow forever (~110MB per hour).
 */
const UTTERANCE_PCM_MAX_BYTES = 32_000 * 60; // 60s of 16k/16bit/mono
/**
 * Speaker-turn heuristic: a silence gap longer than this flips the speaker label.
 * Only used when voiceprint embedding is unavailable (mic hiccup / <1s utterance).
 */
const SPEAKER_GAP_MS = 8000;
/** min cosine to merge an un-enrolled utterance into an existing stranger cluster */
const STRANGER_CLUSTER_THRESHOLD = 0.6;
/** below this many seconds an utterance is treated as a mid-sentence split */
const SHORT_UTTERANCE_SEC = 1.2;

function utteranceShort(pcmChunks: Buffer[]): boolean {
  const bytes = pcmChunks.reduce((n, c) => n + c.byteLength, 0);
  return bytes / 32000 < SHORT_UTTERANCE_SEC;
}

type AsrLike = Pick<VolcAsrService, 'start' | 'feed' | 'stop'>;

export class SessionController {
  private sessionId = '';
  private startedAt = 0;
  private segments: TranscriptSegment[] = [];
  private cards: CopilotCard[] = [];
  private summary: string[] = [];
  private asr: AsrLike | null = null;
  private ai: AiLike | null = null;
  private asrStatus: ServiceStatus = 'idle';
  private aiStatus: ServiceStatus = 'idle';
  private asrError: string | null = null;
  private aiError: string | null = null;
  private partial = '';
  private aiTimer: NodeJS.Timeout | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;
  private lastAnalyzedCount = 0;
  private analyzing = false;
  private mock = false;
  private paused = false;
  private pausedMs = 0;
  private pausedAt: number | null = null;
  private lastFinalAt = 0;
  private speakerB = false;
  /** Last speaker label; short mid-sentence splits inherit it. */
  private lastSpeaker: string | null = null;
  /** Raw PCM accumulated for the utterance currently being spoken. */
  private utterancePcm: Buffer[] = [];
  /** Bytes currently buffered in utterancePcm (kept in step, for the cap). */
  private utterancePcmBytes = 0;
  /** Guards stop() against re-entry (the renderer can fire it twice). */
  private stopping = false;
  /** The in-flight stop(), so a caller can wait for it instead of racing it. */
  private stopPromise: Promise<{ sessionId: string; durationMs: number } | null> | null = null;
  /** Serializes labeling so async voiceprint never reorders segments. */
  private labelQueue: Promise<void> = Promise.resolve();
  /** Un-enrolled voices seen this session, kept apart by embedding similarity. */
  private strangerClusters: Array<{ label: string; vector: number[] }> = [];
  /** Total audio written to the wav so far (ms). */
  private audioMs = 0;
  /** Audio-timeline position where the current utterance started. */
  private utteranceStartAudioMs = 0;
  /** Text-model config captured at start, for the auto title call. */
  private titleCfg: { apiKey: string; model: string; baseUrl: string } | null = null;
  private titleRequested = false;
  private titleTimer: NodeJS.Timeout | null = null;
  /** Auto title (mirrors session.json until generated). */
  private title: string | null = null;
  /** Rebuilds a fresh ASR connection; used on resume after a real pause. */
  private asrFactory: (() => AsrLike) | null = null;
  /** wav-timeline position where the current ASR stream started (ms). */
  private asrStreamOffsetMs = 0;

  constructor(private readonly emit: (snapshot: LiveSnapshot) => void) {}

  async start(settings: Settings, demo = false): Promise<string> {
    // A session can still be running here: the sidebar keeps Home clickable
    // during a live session, so Start is reachable mid-session. Close the old
    // one properly first — otherwise it is orphaned forever (ended_at stays
    // null, its wav is never finalized) and lingers in History as a zombie.
    // If a stop is already in flight, wait for it: it must finish writing
    // before we replace the session id.
    if (this.stopPromise) await this.stopPromise;
    if (this.sessionId) await this.stop();
    this.sessionId = createSession().id;
    this.startedAt = Date.now();
    this.segments = [];
    this.cards = [];
    this.summary = [];
    this.partial = '';
    this.lastAnalyzedCount = 0;
    this.paused = false;
    this.pausedMs = 0;
    this.pausedAt = null;
    this.lastFinalAt = 0;
    this.speakerB = false;
    this.lastSpeaker = null;
    this.utterancePcm = [];
    this.labelQueue = Promise.resolve();
    this.strangerClusters = [];
    this.audioMs = 0;
    this.utteranceStartAudioMs = 0;
    this.utterancePcmBytes = 0;
    this.titleCfg = null;
    this.titleRequested = false;
    if (this.titleTimer) clearTimeout(this.titleTimer);
    this.titleTimer = null;
    this.title = null;
    // Demo only runs when explicitly requested via the demo button.
    // Start always runs the real pipeline; without an AI key the transcript
    // still works and Copilot reports what is missing.
    this.mock = demo;

    if (this.mock) {
      const makeMock = () =>
        new MockAsrDriver({
          onStatus: (s, e) => {
            this.asrStatus = s;
            this.asrError = e ?? null;
            this.push();
          },
          onPartial: (text) => {
            this.partial = text;
            this.push();
          },
          onFinal: (seg) => this.onFinalSegment(seg),
          onEnded: () => void this.autoEndMock(),
        });
      this.asrFactory = makeMock;
      this.asr = makeMock();
      this.asr.start();
      this.ai = new MockAiService();
      // The demo script has a fixed storyline, so give it a fixed title
      // instead of the "first sentence" fallback.
      setTitleIfDefault(this.sessionId, DEMO_TITLE);
    } else {
      const makeVolc = () =>
        new VolcAsrService(settings.volcApiKey, settings.volcResourceId, {
          onStatus: (s, e) => {
            this.asrStatus = s;
            this.asrError = e ?? null;
            this.push();
          },
          onPartial: (text) => {
            this.partial = text;
            this.push();
          },
          onFinal: (seg) => this.onFinalSegment(seg),
        });
      this.asrFactory = makeVolc;
      this.asr = makeVolc();
      this.asr.start();
      this.asrStreamOffsetMs = 0;
      const cfg = activeTextConfig(settings);
      if (hasAiKey(settings)) {
        this.ai = new DeepSeekAiService(cfg.apiKey, cfg.model, cfg.baseUrl);
        this.titleCfg = { apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl };
      } else {
        this.ai = null;
        this.aiStatus = 'idle';
        this.aiError = '未配置文字模型 Key，Copilot 暂不可用（转录不受影响）';
      }
      // Session recording (16k/16bit/mono wav) — best effort, never blocks ASR.
      try {
        startAudio(this.sessionId);
      } catch (err) {
        console.error('[session] audio capture failed:', (err as Error).message);
      }
    }

    this.periodicTimer = setInterval(() => {
      if (this.segments.length > this.lastAnalyzedCount) this.scheduleAnalyze(0);
    }, AI_PERIODIC_MS);
    this.push();
    return this.sessionId;
  }

  private onFinalSegment(seg: {
    text: string;
    start_ms: number;
    end_ms: number;
    speaker?: string;
  }): void {
    const now = Date.now();
    const id = this.sessionId;
    const pcmChunks = this.utterancePcm;
    this.utterancePcm = [];
    this.utterancePcmBytes = 0;
    this.partial = '';
    this.push();
    // The session can end while this utterance is still being labeled (the
    // embedding is async). Bind the segment to the id captured now so it can
    // never be written against a newer session — or, worse, against '' which
    // would land in the sessions root directory.
    if (!id) return;
    // Serialize: voiceprint embedding is async but segments must stay ordered.
    this.labelQueue = this.labelQueue
      .then(() => this.appendLabeledSegment(id, seg.text, seg, now, pcmChunks))
      .catch(() => undefined);
  }

  private async appendLabeledSegment(
    id: string,
    text: string,
    seg: { start_ms: number; end_ms: number; speaker?: string },
    now: number,
    pcmChunks: Buffer[],
  ): Promise<void> {
    // Timeline: when recording, prefer the ASR-provided utterance start/end —
    // it marks where the voice actually begins. The wav timeline and the ASR
    // stream share the same PCM stream (verified: first utterance starts at 0,
    // end_ms of one line == start_ms of the next), so the values line up.
    // Marking "first packet after the previous final" instead drags in trailing
    // silence — a click would play seconds of silence before the voice.
    let startMs: number;
    let endMs: number;
    if (!this.mock && seg.start_ms > 0 && seg.start_ms < 1e12) {
      // ASR stream-relative start, re-based onto the wav timeline (the stream
      // restarts at 0 after every resume-from-pause).
      startMs = Math.max(0, Math.round(seg.start_ms) + this.asrStreamOffsetMs);
      endMs = Math.max(Math.round(seg.end_ms) + this.asrStreamOffsetMs, startMs + 500);
    } else if (!this.mock && this.audioMs > 0) {
      startMs = this.utteranceStartAudioMs;
      endMs = Math.min(this.audioMs, startMs + 500);
    } else {
      // Drivers may send absolute epoch ms (local sherpa), relative ms (mock/volc), or 0.
      const rel = (ms: number) => Math.max(0, Math.round(ms - this.startedAt));
      startMs = seg.start_ms >= 1e12 ? rel(seg.start_ms) : seg.start_ms > 0 ? seg.start_ms : rel(now);
      endMs = seg.end_ms >= 1e12 ? rel(seg.end_ms) : seg.end_ms > 0 ? seg.end_ms : rel(now);
    }

    // Speaker labeling, best-effort in order:
    //  0) scripted demo lines carry their own speaker
    //  1) enrolled voiceprint profiles ("我", "张三", ...)
    //  2) stranger clusters kept in-session (TA / TA2 / ...), centroids drift
    //     slightly toward each new match so noise doesn't shatter one speaker
    //     into many
    //  3) very short / un-embeddable utterances: keep the previous speaker
    //     (ASR often splits one person's sentence mid-way)
    //  4) pause-based turn heuristic (only when no voiceprint at all)
    let speaker: string | null = null;
    if (this.mock && seg.speaker) {
      speaker = seg.speaker;
    }
    const vector = !speaker && pcmChunks.length > 0 ? embedUtterance(Buffer.concat(pcmChunks)) : null;
    if (vector) {
      const hit = matchEnrolled(vector);
      if (hit) {
        speaker = hit.name;
      } else {
        let cluster = this.strangerClusters.find((c) => cosine(vector, c.vector) >= STRANGER_CLUSTER_THRESHOLD);
        if (cluster) {
          // Pull the centroid toward the new sample for stability.
          const w = 0.6;
          cluster.vector = cluster.vector.map((v, i) => w * v + (1 - w) * (vector[i] ?? 0));
          speaker = cluster.label;
        } else {
          // First stranger is plain "TA"; extra ones get TA2, TA3, ...
          const label =
            this.strangerClusters.length === 0 ? 'TA' : `TA${this.strangerClusters.length + 1}`;
          this.strangerClusters.push({ label, vector });
          speaker = label;
        }
      }
    }
    if (!speaker && this.lastSpeaker && utteranceShort(pcmChunks)) {
      speaker = this.lastSpeaker;
    }
    if (!speaker) {
      if (this.lastFinalAt && now - this.lastFinalAt > SPEAKER_GAP_MS) {
        this.speakerB = !this.speakerB;
      }
      speaker = this.speakerB ? 'TA' : '我';
    }
    this.lastSpeaker = speaker;
    this.lastFinalAt = now;

    const segment: TranscriptSegment = {
      idx: this.segments.length,
      text,
      speaker,
      start_ms: startMs,
      end_ms: endMs,
      definitive: true,
    };
    this.segments.push(segment);
    appendSegments(id, [segment]);
    this.push();
    this.scheduleTitle();
    this.scheduleAnalyze(AI_DEBOUNCE_MS);
  }

  /**
   * ChatGPT-style auto title: once the conversation has a couple of lines,
   * ask the text model for a short title. Silently falls back to the first
   * sentence when no AI is configured or the call fails.
   */
  private scheduleTitle(): void {
    if (this.titleRequested || this.mock || this.segments.length < 2) return;
    this.titleRequested = true;
    const fallback = this.segments[0]?.text.slice(0, 12) ?? '';
    const cfg = this.titleCfg;
    if (!cfg) {
      const meta = setTitleIfDefault(this.sessionId, fallback);
      this.title = meta?.title ?? null;
      return;
    }
    this.titleTimer = setTimeout(() => {
      void generateTitle(cfg.apiKey, cfg.model, cfg.baseUrl, this.transcriptTail())
        .then((title) => setTitleIfDefault(this.sessionId, title || fallback))
        .catch(() => setTitleIfDefault(this.sessionId, fallback))
        .then((meta) => {
          this.title = meta?.title ?? this.title;
        })
        .finally(() => this.push());
    }, 1500);
  }

  private scheduleAnalyze(delay: number): void {
    if (!this.sessionId) return;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(() => void this.runAnalyze(), delay);
  }

  private async runAnalyze(): Promise<void> {
    if (!this.ai || !this.sessionId || this.analyzing || this.segments.length === 0) return;
    this.analyzing = true;
    this.aiStatus = 'connecting';
    this.push();
    try {
      const output = await this.ai.analyze({
        transcriptTail: this.transcriptTail(),
        summarySoFar: this.summary,
        pendingCards: this.cards.filter((c) => c.state === 'pending'),
      });

      if (output.summary.length > 0) this.summary = output.summary;

      for (const draft of output.newCards) {
        const duplicate = this.cards.some(
          (c) =>
            c.state === 'pending' &&
            (c.title === draft.title ||
              c.suggested_text.slice(0, 14) === draft.suggested_text.slice(0, 14)),
        );
        if (duplicate) continue;
        this.cards.push({
          id: randomUUID(),
          type: draft.type,
          title: draft.title,
          context: draft.context,
          suggested_text: draft.suggested_text,
          state: 'pending',
          created_at: new Date().toISOString(),
          resolved_at: null,
        });
      }

      const now = new Date().toISOString();
      for (const resolution of output.resolutions) {
        // Cards only ever resolve to confirmed: expired/dismissed verdicts are
        // ignored — pending cards stay for later review instead of vanishing.
        if (resolution.state !== 'confirmed') continue;
        const card = this.cards.find((c) => c.id === resolution.card_id);
        if (!card || card.state !== 'pending') continue;
        card.state = 'confirmed';
        card.resolved_at = now;
        card.resolve_reason = resolution.reason;
      }

      this.lastAnalyzedCount = this.segments.length;
      this.aiStatus = 'running';
      this.aiError = null;
      updateCards(this.sessionId, this.cards, this.summary);
    } catch (err) {
      this.aiStatus = 'error';
      this.aiError = (err as Error).message || 'AI 调用失败';
    } finally {
      this.analyzing = false;
      this.push();
      // Segments that arrived mid-analysis still need a pass.
      if (this.segments.length > this.lastAnalyzedCount) this.scheduleAnalyze(1200);
    }
  }

  private transcriptTail(): string {
    const lines: string[] = [];
    let chars = 0;
    for (let i = this.segments.length - 1; i >= 0; i -= 1) {
      const segment = this.segments[i];
      const prefix = `[${segment.speaker ?? '未知'}] `;
      let line = prefix + segment.text;
      if (lines.length === 0 && line.length > TRANSCRIPT_WINDOW_CHARS) {
        line = prefix + segment.text.slice(-(TRANSCRIPT_WINDOW_CHARS - prefix.length));
      }
      const added = line.length + (lines.length > 0 ? 1 : 0);
      if (chars + added > TRANSCRIPT_WINDOW_CHARS) break;
      lines.unshift(line);
      chars += added;
    }
    return lines.join('\n');
  }

  feedPcm(pcm: Buffer): void {
    if (this.paused) return;
    this.asr?.feed(pcm);
    // Nothing to attribute the audio to once the session is closed.
    if (this.mock || !this.sessionId) return;
    // A new utterance starts when the buffer is empty: record its position
    // on the wav timeline for transcript seek-to-click in History.
    if (this.utterancePcm.length === 0) this.utteranceStartAudioMs = this.audioMs;
    this.utterancePcm.push(Buffer.from(pcm));
    this.utterancePcmBytes += pcm.byteLength;
    // Safety valve: if the ASR stream stalls and never returns a final, the
    // buffer would otherwise grow without bound (~110MB per hour).
    while (this.utterancePcmBytes > UTTERANCE_PCM_MAX_BYTES && this.utterancePcm.length > 1) {
      const dropped = this.utterancePcm.shift();
      if (dropped) this.utterancePcmBytes -= dropped.byteLength;
    }
    try {
      this.audioMs = appendAudio(this.sessionId, pcm);
    } catch {
      /* recording is best-effort */
    }
  }

  /**
   * Real pause: tear down the ASR connection (the Volcengine side times out on
   * silent sockets, and the mic stays hot otherwise) and stop pulling PCM.
   * Resume rebuilds a fresh ASR stream and re-bases its timestamps onto the
   * wav timeline via asrStreamOffsetMs.
   */
  pause(): void {
    if (!this.sessionId || this.paused) return;
    this.paused = true;
    this.pausedAt = Date.now();
    this.partial = '';
    if (this.mock && this.asr && 'pause' in this.asr) {
      (this.asr as MockAsrDriver).pause();
    } else {
      this.asr?.stop();
    }
    this.asrStatus = 'stopped';
    this.push();
  }

  resume(): void {
    if (!this.sessionId || !this.paused) return;
    this.paused = false;
    if (this.pausedAt !== null) {
      this.pausedMs += Date.now() - this.pausedAt;
      this.pausedAt = null;
    }
    if (this.mock && this.asr && 'resume' in this.asr) {
      (this.asr as MockAsrDriver).resume();
    } else {
      // New ASR stream: its start_ms restarts from 0, so offset it onto the
      // wav timeline (which kept growing until the pause).
      this.asrStreamOffsetMs = this.audioMs;
      this.asr = this.asrFactory ? this.asrFactory() : null;
      this.asr?.start();
    }
    this.push();
  }

  /** The demo script finished playing: close the session automatically. */
  private autoEndMock(): void {
    if (!this.sessionId) return;
    void this.stop().then(() => this.push());
  }

  dismissCard(id: string): void {
    if (!this.sessionId) return;
    const card = this.cards.find((c) => c.id === id);
    if (!card || card.state !== 'pending') return;
    card.state = 'dismissed';
    card.resolved_at = new Date().toISOString();
    card.resolve_reason = 'user_dismissed';
    updateCards(this.sessionId, this.cards, this.summary);
    this.push();
  }

  /** Toggle the review star on any card. */
  starCard(id: string): void {
    if (!this.sessionId) return;
    const card = this.cards.find((c) => c.id === id);
    if (!card) return;
    card.starred = !card.starred;
    updateCards(this.sessionId, this.cards, this.summary);
    this.push();
  }

  async stop(): Promise<{ sessionId: string; durationMs: number } | null> {
    // The renderer fires stop twice on the same transition (End button + the
    // App-level effect), so a second call just waits for the first instead of
    // repeating every write.
    if (this.stopping) return this.stopPromise;
    if (!this.sessionId) return null;
    this.stopping = true;
    this.stopPromise = this.closeCurrent();
    try {
      return await this.stopPromise;
    } finally {
      this.stopping = false;
      this.stopPromise = null;
    }
  }

  /** Closes the running session: finalizes audio, wraps up the AI pass, persists. */
  private async closeCurrent(): Promise<{ sessionId: string; durationMs: number } | null> {
    // Bind every write below to *this* session: a new session may start while
    // we are still waiting on the wrap-up AI pass, and late async callbacks
    // must never touch the new id.
    const id = this.sessionId;
    this.asr?.stop();
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    if (this.titleTimer) clearTimeout(this.titleTimer);
    this.aiTimer = null;
    this.periodicTimer = null;
    this.titleTimer = null;
    this.utterancePcm = [];
    this.utterancePcmBytes = 0;
    if (this.mock) {
      // The demo never touches the microphone, so it has no recording of its
      // own. Fill in silence covering the whole script: History then shows the
      // player and click-a-line-to-seek behaves exactly like a real session.
      const lastEnd = this.segments.reduce((m, s) => Math.max(m, s.end_ms), 0);
      try {
        writeSilentWav(id, Math.max(Date.now() - this.startedAt, lastEnd + 1000));
      } catch {
        /* best effort */
      }
    }
    try {
      finishAudio(id);
    } catch {
      /* best effort */
    }
    // A session must always end with a summary when the AI is configured:
    // run one last analyze over whatever arrived after the previous pass.
    if (this.ai && this.segments.length > 0) {
      try {
        // Bounded: the AI client retries 3x with backoff, and End must not
        // hang on a dead network. Whatever summary we already have is kept.
        await Promise.race([this.runAnalyze(), sleep(FINAL_ANALYZE_TIMEOUT_MS)]);
      } catch {
        /* aiError is recorded by runAnalyze */
      }
    }
    // The wrap-up pass may have re-armed the debounce timer; drop it too.
    if (this.aiTimer) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
    // No AI was configured: still give the session a readable fallback title.
    if (!this.titleCfg) setTitleIfDefault(id, this.segments[0]?.text.slice(0, 12) ?? '');
    const durationMs = Date.now() - this.startedAt;
    finishSession(id, durationMs);
    updateCards(id, this.cards, this.summary);
    // Only release the slot if it is still ours — a new session may have
    // started while we were awaiting the AI, and clearing it then would
    // orphan that new session.
    if (this.sessionId === id) this.sessionId = '';
    // Push the empty-session snapshot so the renderer knows the session is
    // over (it navigates to History on this transition).
    this.push();
    return { sessionId: id, durationMs };
  }

  isRunning(): boolean {
    return Boolean(this.sessionId);
  }

  private push(): void {
    this.emit({
      sessionId: this.sessionId,
      title: this.title,
      segments: [...this.segments],
      summary: [...this.summary],
      cards: [...this.cards],
      asrStatus: this.asrStatus,
      aiStatus: this.aiStatus,
      asrError: this.asrError,
      aiError: this.aiError,
      mock: this.mock,
      partial: this.partial,
      paused: this.paused,
      pausedMs: this.pausedMs,
      pausedAt: this.pausedAt,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
