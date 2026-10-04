// Shared types between main process and renderer.

export type CardType = 'need_to_ask' | 'suggested_reply';

export type CardState = 'pending' | 'confirmed' | 'dismissed';

export type ResolveReason =
  | 'user_asked'
  | 'user_replied'
  | 'answered_by_counterpart'
  | 'expired'
  | 'user_dismissed';

export interface CopilotCard {
  id: string;
  type: CardType;
  title: string;
  context: string;
  suggested_text: string;
  state: CardState;
  created_at: string;
  resolved_at: string | null;
  resolve_reason?: ResolveReason;
  /** Transcript segment used as evidence for a live model resolution. */
  resolve_segment_idx?: number;
  /** User starred for later review; survives state changes. */
  starred?: boolean;
}

export interface TranscriptSegment {
  idx: number;
  text: string;
  speaker: string | null;
  start_ms: number;
  end_ms: number;
  definitive: boolean;
}

export interface SessionMeta {
  id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
}

export interface SessionRecord {
  meta: SessionMeta;
  summary: string[];
  transcript: TranscriptSegment[];
  cards: CopilotCard[];
  /** Absolute path of the session recording (wav), null when missing. */
  audioPath: string | null;
}

export interface SearchHit {
  meta: SessionMeta;
  /** Which part matched. */
  field: '标题' | '转录' | '总结' | 'Copilot';
  snippet: string;
}

export type SpeechProviderId = 'volc';
export type TextProviderId = 'deepseek' | 'glm' | 'siliconflow';

export interface ProviderModel {
  id: string;
  label: string;
}

/** A provider preset: everything pre-wired, the user only supplies a key and picks a model. */
export interface SpeechProviderPreset {
  id: SpeechProviderId;
  label: string;
  note: string;
  needsKey: boolean;
  offline: boolean;
  models: ProviderModel[];
  defaultModel: string;
}

export interface TextProviderPreset {
  id: TextProviderId;
  label: string;
  note: string;
  needsKey: boolean;
  offline: boolean;
  baseUrl: string;
  models: ProviderModel[];
  defaultModel: string;
}

export const SPEECH_PROVIDERS: SpeechProviderPreset[] = [
  {
    id: 'volc',
    label: '火山引擎 · 云端流式',
    note: '豆包流式 2.0（bigmodel），延迟低、支持方言与热词。需 API Key，按小时计费。',
    needsKey: true,
    offline: false,
    models: [{ id: 'volc.seedasr.sauc.duration', label: '豆包流式 2.0 · 小时版' }],
    defaultModel: 'volc.seedasr.sauc.duration',
  },
];

export const TEXT_PROVIDERS: TextProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    note: 'PRD 默认，性价比高。',
    needsKey: true,
    offline: false,
    baseUrl: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-chat', label: 'deepseek-chat · 日常' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner · 推理' },
    ],
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    note: 'GLM-4 系列 Flash，中文好；计费以供应商当前规则为准。',
    needsKey: true,
    offline: false,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4.7-flash', label: 'glm-4.7-flash · 默认' },
      { id: 'glm-4-flash', label: 'glm-4-flash' },
    ],
    defaultModel: 'glm-4.7-flash',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    note: '9B 以下模型免费额度，模型最全。',
    needsKey: true,
    offline: false,
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      { id: 'Qwen2.5-7B-Instruct', label: 'Qwen2.5-7B · 免费档' },
      { id: 'Qwen3-8B', label: 'Qwen3-8B · 免费档' },
    ],
    defaultModel: 'Qwen2.5-7B-Instruct',
  },
];

export function speechPreset(id: SpeechProviderId): SpeechProviderPreset {
  return SPEECH_PROVIDERS.find((p) => p.id === id) ?? SPEECH_PROVIDERS[0];
}

export function textPreset(id: TextProviderId): TextProviderPreset {
  return TEXT_PROVIDERS.find((p) => p.id === id) ?? TEXT_PROVIDERS[0];
}

export interface Settings {
  /** Which speech provider is active. */
  speechProvider: SpeechProviderId;
  volcApiKey: string;
  volcResourceId: string;

  /** Which text provider is active. */
  textProvider: TextProviderId;
  /** Key per provider, so switching providers never loses a key (same idea as cc-switch). */
  textApiKeys: Record<TextProviderId, string>;
  /** Model per provider. */
  textModels: Record<TextProviderId, string>;

  language: string;
}

export type ServiceStatus = 'idle' | 'connecting' | 'running' | 'stopped' | 'error';

export interface LiveSnapshot {
  sessionId: string;
  /** Auto-generated session title (ChatGPT style); null until generated. */
  title: string | null;
  segments: TranscriptSegment[];
  summary: string[];
  cards: CopilotCard[];
  asrStatus: ServiceStatus;
  aiStatus: ServiceStatus;
  asrError: string | null;
  aiError: string | null;
  mock: boolean;
  /** Text the speaker is still in the middle of (non-final ASR result). */
  partial: string;
  /** True while the user paused the live session. */
  paused: boolean;
  /** Total paused duration (ms) so the on-screen clock can exclude it. */
  pausedMs: number;
  /** Epoch ms when the current pause started; null while running. */
  pausedAt: number | null;
}

export interface TestResult {
  ok: boolean;
  message: string;
}
