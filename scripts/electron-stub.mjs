// Minimal `electron` stand-in so the main-process code can be driven headlessly
// by scripts/state-machine-check.mts (no window, no network, no real userData).
//
// userData points into the OS temp dir, so the check never touches (or deletes)
// the data of an actually installed Virgil.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(tmpdir(), 'virgil-state-check', 'userdata');
mkdirSync(ROOT, { recursive: true });

export const app = {
  getPath: () => join(ROOT, 'userData'),
  getAppPath: () => join(ROOT, 'app'),
  getName: () => 'virgil',
  setName: () => undefined,
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  on: () => undefined,
  quit: () => undefined,
  dock: undefined,
};

export const ipcMain = { handle: () => undefined, on: () => undefined };
export const ipcRenderer = {
  invoke: async () => null,
  on: () => undefined,
  removeListener: () => undefined,
};
export const contextBridge = { exposeInMainWorld: () => undefined };
export const shell = { openExternal: () => undefined };
export const screen = { getPrimaryDisplay: () => ({ workArea: { width: 1440, height: 900 } }) };
export const safeStorage = {
  decryptString: () => '',
  encryptString: (s) => Buffer.from(String(s), 'utf8'),
};
export class BrowserWindow {
  static getAllWindows() {
    return [];
  }
}
export const systemPreferences = { getMediaAccessStatus: () => 'granted' };
