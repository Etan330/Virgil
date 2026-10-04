import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  LiveSnapshot,
  SearchHit,
  SessionMeta,
  SessionRecord,
  Settings,
  TestResult,
} from '../shared/types';

export interface VirgilApi {
  getSettings: () => Promise<Settings>;
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>;
  voiceprintList: () => Promise<Array<{ name: string; enrolledAt: string }>>;
  voiceprintEnroll: (
    name: string,
    pcm: ArrayBuffer,
  ) => Promise<{ ok: boolean; message: string; enrolled: boolean }>;
  voiceprintDelete: (name: string) => Promise<boolean>;
  testVolc: (apiKey: string, resourceId: string) => Promise<TestResult>;
  testDeepSeek: (apiKey: string, model: string, baseUrl: string) => Promise<TestResult>;

  startSession: (demo?: boolean) => Promise<string>;
  sendPcm: (pcm: ArrayBuffer) => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  stopSession: () => Promise<{ sessionId: string; durationMs: number } | null>;
  isSessionRunning: () => Promise<boolean>;
  dismissCard: (id: string) => Promise<void>;
  starCard: (id: string) => Promise<void>;
  collapseToMini: () => Promise<void>;
  restoreFromMini: () => Promise<void>;
  onSnapshot: (cb: (snapshot: LiveSnapshot) => void) => () => void;
  lastSnapshot: () => Promise<LiveSnapshot | null>;

  listSessions: () => Promise<SessionMeta[]>;
  loadSession: (id: string) => Promise<SessionRecord | null>;
  renameSession: (id: string, title: string) => Promise<SessionMeta | null>;
  deleteSession: (id: string) => Promise<boolean>;
  searchSessions: (query: string) => Promise<SearchHit[]>;
}

const api: VirgilApi = {
  voiceprintList: () => ipcRenderer.invoke('voiceprint:list'),
  voiceprintEnroll: (name, pcm) => ipcRenderer.invoke('voiceprint:enroll', name, pcm),
  voiceprintDelete: (name) => ipcRenderer.invoke('voiceprint:delete', name),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  testVolc: (apiKey, resourceId) => ipcRenderer.invoke('settings:testVolc', apiKey, resourceId),
  testDeepSeek: (apiKey, model, baseUrl) =>
    ipcRenderer.invoke('settings:testDeepSeek', apiKey, model, baseUrl),

  startSession: (demo) => ipcRenderer.invoke('session:start', demo),
  sendPcm: (pcm) => ipcRenderer.invoke('session:pcm', pcm),
  pauseSession: () => ipcRenderer.invoke('session:pause'),
  resumeSession: () => ipcRenderer.invoke('session:resume'),
  stopSession: () => ipcRenderer.invoke('session:stop'),
  isSessionRunning: () => ipcRenderer.invoke('session:running'),
  dismissCard: (id) => ipcRenderer.invoke('card:dismiss', id),
  starCard: (id) => ipcRenderer.invoke('card:star', id),
  collapseToMini: () => ipcRenderer.invoke('window:collapseToMini'),
  restoreFromMini: () => ipcRenderer.invoke('window:restoreFromMini'),
  onSnapshot: (cb) => {
    const listener = (_event: IpcRendererEvent, snapshot: LiveSnapshot) => cb(snapshot);
    ipcRenderer.on('live:snapshot', listener);
    return () => ipcRenderer.removeListener('live:snapshot', listener);
  },
  lastSnapshot: () => ipcRenderer.invoke('session:lastSnapshot'),

  listSessions: () => ipcRenderer.invoke('session:list'),
  loadSession: (id) => ipcRenderer.invoke('session:load', id),
  renameSession: (id, title) => ipcRenderer.invoke('session:rename', id, title),
  deleteSession: (id) => ipcRenderer.invoke('session:delete', id),
  searchSessions: (query) => ipcRenderer.invoke('session:search', query),
};

contextBridge.exposeInMainWorld('virgil', api);
