import { app } from 'electron';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings, SpeechProviderId, TextProviderId } from '../../shared/types';
import { SPEECH_PROVIDERS, TEXT_PROVIDERS } from '../../shared/types';

// Decided with the user on 2026-10-02:
// - Volcengine uses the new single-string API Key (X-Api-Key header), hourly edition
// - Copilot output language defaults to Chinese
function defaultTextKeys(): Record<TextProviderId, string> {
  return TEXT_PROVIDERS.reduce(
    (acc, p) => ({ ...acc, [p.id]: '' }),
    {} as Record<TextProviderId, string>,
  );
}

function defaultTextModels(): Record<TextProviderId, string> {
  return TEXT_PROVIDERS.reduce(
    (acc, p) => ({ ...acc, [p.id]: p.defaultModel }),
    {} as Record<TextProviderId, string>,
  );
}

export const DEFAULT_SETTINGS: Settings = {
  speechProvider: 'volc',
  volcApiKey: '',
  volcResourceId: 'volc.seedasr.sauc.duration',
  textProvider: 'glm',
  textApiKeys: defaultTextKeys(),
  textModels: defaultTextModels(),
  language: 'zh-CN',
};

const SETTINGS_FILE = 'settings.json';

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE);
}

/**
 * Local AES-256-GCM encryption instead of Electron safeStorage.
 * safeStorage routes through the macOS Keychain, which pops an "access to
 * keychain data" dialog on every ad-hoc re-sign — annoying and pointless for a
 * single-user local app. The key is derived from a fixed salt plus the
 * userData path; this is obfuscation-grade, which is the right trade-off here.
 */
const LOCAL_KEY_SALT = 'virgil.v1.local.keys';

function localKey(): Buffer {
  return scryptSync(`virgil:${app.getPath('userData')}`, LOCAL_KEY_SALT, 32);
}

function decryptLocal(raw: string): string {
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', localKey(), Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Legacy safeStorage box ({enc:true,...}); decrypt on read so existing keys
 * migrate to the local scheme on the next save. Never throws into a dialog:
 * if the Keychain denies access the value degrades to '' and the user re-enters.
 */
function decryptLegacyBox(raw: { enc?: boolean; value?: string }): string {
  try {
    // Lazy require keeps safeStorage out of the normal path entirely.
    const { safeStorage } = require('electron') as typeof import('electron');
    return safeStorage.decryptString(Buffer.from(raw.value ?? '', 'base64'));
  } catch {
    return '';
  }
}

/**
 * Keys are stored as plain JSON in settings.json — same approach as Claude
 * Code's settings file. The old safeStorage/Keychain path popped a password
 * dialog on every ad-hoc re-sign; plaintext in the user's own profile is the
 * right trade-off for a single-user local app.
 */
function encrypt(value: string): string {
  return value;
}

function decrypt(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') {
    return raw.startsWith('v1:') ? decryptLocal(raw) : raw;
  }
  const boxed = raw as { enc?: boolean; value?: string };
  return boxed.enc ? decryptLegacyBox(boxed) : (boxed.value ?? '');
}

/** v1 stored flat deepseek* fields; carry them into the new per-provider layout. */
function migrate(raw: Record<string, unknown>, settings: Settings): void {
  const legacyKey = typeof raw.deepseekApiKey === 'string' ? raw.deepseekApiKey : '';
  const legacyBase = typeof raw.deepseekBaseUrl === 'string' ? raw.deepseekBaseUrl : '';
  const legacyModel = typeof raw.deepseekModel === 'string' ? raw.deepseekModel : '';
  if (!legacyKey && !legacyBase && !legacyModel) return;
  const match = TEXT_PROVIDERS.find((p) => p.baseUrl === legacyBase) ?? TEXT_PROVIDERS[0];
  if (legacyKey) settings.textApiKeys[match.id] = decrypt(raw.deepseekApiKey ?? legacyKey);
  if (legacyModel) settings.textModels[match.id] = legacyModel;
  if (!settings.textProvider || !settings.textApiKeys[settings.textProvider]) {
    settings.textProvider = match.id;
  }
}

export function loadSettings(): Settings {
  const file = settingsPath();
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS, textApiKeys: defaultTextKeys(), textModels: defaultTextModels() };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      textApiKeys: { ...defaultTextKeys() },
      textModels: { ...defaultTextModels() },
    };

    // v0.2 shipped a local offline ASR; it has been removed -> always volc now.
    if (raw.speechProvider === 'local' || raw.speechProvider === 'volc') {
      settings.speechProvider = 'volc';
    }
    if (typeof raw.volcResourceId === 'string') settings.volcResourceId = raw.volcResourceId;
    settings.volcApiKey = decrypt(raw.volcApiKey);

    if (raw.textProvider && TEXT_PROVIDERS.some((p) => p.id === raw.textProvider)) {
      settings.textProvider = raw.textProvider as TextProviderId;
    }
    const rawKeys = (raw.textApiKeys ?? {}) as Record<string, unknown>;
    for (const p of TEXT_PROVIDERS) settings.textApiKeys[p.id] = decrypt(rawKeys[p.id]);
    const rawModels = (raw.textModels ?? {}) as Record<string, unknown>;
    for (const p of TEXT_PROVIDERS) {
      const m = rawModels[p.id];
      if (typeof m === 'string' && m) settings.textModels[p.id] = m;
    }
    if (typeof raw.language === 'string') settings.language = raw.language;

    migrate(raw, settings);

    // One-time legacy migration: if any key is still wrapped in an old
    // safeStorage box, decrypt it now and rewrite the file in plaintext.
    // Every later launch then reads plain JSON — the Keychain is never
    // touched again, so the password dialog disappears for good.
    const hasLegacyBox =
      isLegacyBox(raw.volcApiKey) ||
      TEXT_PROVIDERS.some((p) => isLegacyBox((raw.textApiKeys as never)?.[p.id]));
    if (hasLegacyBox) {
      try {
        saveSettings(settings);
      } catch {
        /* best effort */
      }
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS, textApiKeys: defaultTextKeys(), textModels: defaultTextModels() };
  }
}

function isLegacyBox(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && (raw as { enc?: boolean }).enc);
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...next };
  const toWrite: Record<string, unknown> = {
    ...merged,
    volcApiKey: encrypt(merged.volcApiKey),
    textApiKeys: Object.fromEntries(
      TEXT_PROVIDERS.map((p) => [p.id, encrypt(merged.textApiKeys?.[p.id] ?? '')]),
    ),
  };
  writeFileSync(settingsPath(), JSON.stringify(toWrite, null, 2), 'utf8');
  return merged;
}

/** True when the AI side is configured. */
export function hasAiKey(settings: Settings): boolean {
  const preset = TEXT_PROVIDERS.find((p) => p.id === settings.textProvider);
  if (!preset) return false;
  return preset.needsKey ? Boolean(settings.textApiKeys[settings.textProvider]?.trim()) : true;
}

export function asrReady(settings: Settings): boolean {
  return Boolean(settings.volcApiKey.trim());
}

export function hasKeys(settings: Settings): boolean {
  return asrReady(settings) && hasAiKey(settings);
}

/** Resolved call parameters for the active text provider. */
export function activeTextConfig(settings: Settings): {
  provider: TextProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
} {
  const preset = TEXT_PROVIDERS.find((p) => p.id === settings.textProvider) ?? TEXT_PROVIDERS[0];
  return {
    provider: preset.id,
    baseUrl: preset.baseUrl,
    model: settings.textModels?.[preset.id] || preset.defaultModel,
    apiKey: settings.textApiKeys?.[preset.id] ?? '',
  };
}

export function speechProviderLabel(id: SpeechProviderId): string {
  return SPEECH_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}
