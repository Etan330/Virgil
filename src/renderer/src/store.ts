import { create } from 'zustand';
import type { LiveSnapshot, Settings } from '../../shared/types';

export type Page = 'home' | 'live' | 'history' | 'settings';

const EMPTY_SNAPSHOT: LiveSnapshot = {
  sessionId: '',
  title: null,
  segments: [],
  summary: [],
  cards: [],
  asrStatus: 'idle',
  aiStatus: 'idle',
  asrError: null,
  aiError: null,
  mock: false,
  partial: '',
  paused: false,
  pausedMs: 0,
  pausedAt: null,
};

interface AppState {
  page: Page;
  settings: Settings;
  snapshot: LiveSnapshot;
  startedAt: number | null;
  setPage: (page: Page) => void;
  setSettings: (settings: Settings) => void;
  setSnapshot: (snapshot: LiveSnapshot) => void;
  markStarted: () => void;
  resetLive: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  page: 'home',
  settings: {
    speechProvider: 'volc' as const,
    volcApiKey: '',
    volcResourceId: 'volc.seedasr.sauc.duration',
    textProvider: 'glm' as const,
    textApiKeys: { deepseek: '', glm: '', siliconflow: '' },
    textModels: {
      deepseek: 'deepseek-chat',
      glm: 'glm-4.7-flash',
      siliconflow: 'Qwen2.5-7B-Instruct',
    },
    language: 'zh-CN',
  },
  snapshot: EMPTY_SNAPSHOT,
  startedAt: null,
  setPage: (page) => set({ page }),
  setSettings: (settings) => set({ settings }),
  setSnapshot: (snapshot) => set({ snapshot }),
  markStarted: () => set({ startedAt: Date.now() }),
  resetLive: () => set({ snapshot: EMPTY_SNAPSHOT, startedAt: null }),
}));
