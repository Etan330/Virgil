import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { LiveSnapshot, Settings, TestResult } from '../shared/types';
import { appendLog } from './log';
import { loadSettings, saveSettings } from './store/settings';
import { deleteSession, listSessions, loadSession, renameSession, searchSessions } from './store/sessions';
import { deleteVoiceprint, enrollVoiceprint, listVoiceprints } from './services/voiceprint';
import { SessionController } from './sessionController';
import { VOLC_WS_URL } from './services/asr';
import { buildFullClientRequest } from './services/volcProtocol';

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

// Keep the userData dir identical between dev and packaged builds.
app.setName('virgil');

function writeLog(file: string, ...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  appendLog(file, line);
}

// Persist main-process errors so packaged builds stay debuggable
// (stdout is discarded when launched from Finder).
const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  origConsoleError(...args);
  writeLog('main.log', ...args);
};

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The main window is hidden (not closed) while the Copilot mini
      // floating panel is up; without this Chromium throttles its timers
      // and the audio capture pipeline stutters.
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('console-message', (_event, level, message) => {
    const label = level === 0 ? 'VERBOSE' : level === 1 ? 'INFO' : level === 2 ? 'WARN' : 'ERROR';
    writeLog('renderer.log', `[${label}]`, message);
    if (level >= 2) console.error('[renderer]', message);
  });
  win.webContents.on('did-finish-load', () => {
    writeLog('main.log', 'renderer loaded');
    console.log('[main] renderer loaded');
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (VITE_DEV_SERVER_URL) void win.loadURL(VITE_DEV_SERVER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

let mainWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let controller: SessionController | null = null;
let lastSnapshot: LiveSnapshot | null = null;

function broadcast(snapshot: LiveSnapshot): void {
  lastSnapshot = snapshot;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('live:snapshot', snapshot);
  }
}

/** Small always-on-top panel that shows only the pending copilot cards. */
function ensureMiniWindow(): BrowserWindow {
  if (miniWindow && !miniWindow.isDestroyed()) return miniWindow;
  const { width: screenW } = screen.getPrimaryDisplay().workArea;
  miniWindow = new BrowserWindow({
    width: 340,
    height: 480,
    x: Math.max(8, screenW - 356),
    y: 64,
    frame: false,
    resizable: true,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#f7f8fc',
    show: false,
    minimizable: false,
    fullscreen: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  miniWindow.setAlwaysOnTop(true, 'floating');
  if (VITE_DEV_SERVER_URL) void miniWindow.loadURL(`${VITE_DEV_SERVER_URL}?view=mini`);
  else void miniWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: 'view=mini' });
  miniWindow.webContents.on('did-finish-load', () => {
    // Hand the new window the current state right away.
    if (lastSnapshot) miniWindow?.webContents.send('live:snapshot', lastSnapshot);
  });
  miniWindow.on('closed', () => {
    miniWindow = null;
  });
  return miniWindow;
}

/** Collapses the main window into the Copilot mini panel. */
function collapseToMini(): void {
  ensureMiniWindow();
  miniWindow?.show();
  miniWindow?.focus();
  mainWindow?.hide();
}

/** Restores the full main window from the mini panel. */
function restoreFromMini(): void {
  mainWindow?.show();
  mainWindow?.focus();
  miniWindow?.hide();
}

function ensureController(): SessionController {
  if (!controller) {
    controller = new SessionController((snapshot) => {
      broadcast(snapshot);
    });
  }
  return controller;
}

function registerIpc(): void {
  ipcMain.handle('voiceprint:list', () => listVoiceprints());
  ipcMain.handle('voiceprint:enroll', (_e, name: string, pcm: ArrayBuffer) =>
    enrollVoiceprint(name, Buffer.from(pcm)),
  );
  ipcMain.handle('voiceprint:delete', (_e, name: string) => deleteVoiceprint(name));
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => saveSettings(patch));

  ipcMain.handle('settings:testVolc', async (_e, apiKey: string, resourceId: string) =>
    testVolc(apiKey, resourceId),
  );
  ipcMain.handle(
    'settings:testDeepSeek',
    async (_e, apiKey: string, model: string, baseUrl: string) =>
      testDeepSeek(apiKey, model, baseUrl),
  );

  ipcMain.handle('session:start', (_e, demo?: boolean) =>
    ensureController().start(loadSettings(), Boolean(demo)),
  );
  ipcMain.handle('session:pause', () => controller?.pause());
  ipcMain.handle('session:resume', () => controller?.resume());
  ipcMain.handle('session:pcm', (_e, data: ArrayBuffer) => {
    if (!controller) return;
    controller.feedPcm(Buffer.from(data));
  });
  ipcMain.handle('session:stop', () => controller?.stop() ?? null);
  ipcMain.handle('session:running', () => controller?.isRunning() ?? false);
  ipcMain.handle('card:dismiss', (_e, id: string) => controller?.dismissCard(id));
  ipcMain.handle('card:star', (_e, id: string) => controller?.starCard(id));

  ipcMain.handle('window:collapseToMini', () => collapseToMini());
  ipcMain.handle('window:restoreFromMini', () => restoreFromMini());
  ipcMain.handle('session:lastSnapshot', () => lastSnapshot);

  ipcMain.handle('session:list', () => listSessions());
  ipcMain.handle('session:load', (_e, id: string) => loadSession(id));
  ipcMain.handle('session:rename', (_e, id: string, title: string) => renameSession(id, title));
  ipcMain.handle('session:delete', (_e, id: string) => deleteSession(id));
  ipcMain.handle('session:search', (_e, query: string) => searchSessions(query));
}

async function testVolc(apiKey: string, resourceId: string): Promise<TestResult> {
  if (!apiKey?.trim()) return { ok: false, message: '请先填写火山引擎 API Key' };
  return new Promise<TestResult>((resolve) => {
    const done = (result: TestResult) => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    let settled = false;
    const finish = (result: TestResult) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    const ws = new WebSocket(VOLC_WS_URL, {
      headers: {
        'X-Api-Key': apiKey.trim(),
        'X-Api-Resource-Id': resourceId || 'volc.seedasr.sauc.duration',
        'X-Api-Connect-Id': randomUUID(),
        'X-Api-Request-Id': randomUUID(),
        'X-Api-Sequence': '-1',
      },
      handshakeTimeout: 10_000,
    });
    const timer = setTimeout(
      () => finish({ ok: false, message: '连接超时（10s），请检查网络或 API Key' }),
      12_000,
    );
    ws.on('open', () => {
      // Send the handshake frame; the server accepting it proves credentials are valid.
      ws.send(
        buildFullClientRequest({
          user: { uid: 'virgil-test', platform: 'macOS' },
          audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
          request: { model_name: 'bigmodel', show_utterances: true, result_type: 'full' },
        }),
      );
      clearTimeout(timer);
      finish({ ok: true, message: '火山引擎连接成功，凭证有效' });
    });
    ws.on('error', (err: Error) => {
      clearTimeout(timer);
      finish({ ok: false, message: err.message || '连接失败' });
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      finish({ ok: false, message: `服务端返回 ${res.statusCode}，请检查 API Key 或资源 ID` });
    });
  });
}

async function testDeepSeek(
  apiKey: string,
  model: string,
  baseUrl?: string,
): Promise<TestResult> {
  if (!apiKey?.trim()) return { ok: false, message: '请先填写文字模型 API Key' };
  try {
    const base = (baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages: [{ role: 'user', content: '回复两个字：可用' }],
        max_tokens: 8,
        stream: false,
      }),
    });
    if (!res.ok) {
      return { ok: false, message: `模型服务 ${res.status}: ${(await res.text()).slice(0, 160)}` };
    }
    return { ok: true, message: '文字模型连接成功，凭证有效' };
  } catch (err) {
    return { ok: false, message: (err as Error).message || '连接失败' };
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    try {
      app.dock.setIcon(join(app.getAppPath(), 'assets', 'icon.icns'));
    } catch {
      /* dev-only nicety */
    }
  }
  registerIpc();
  mainWindow = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      return;
    }
    // Collapsed into the Copilot mini panel: the main window is only hidden,
    // so a dock click has to bring it back explicitly.
    restoreFromMini();
  });
});

app.on('window-all-closed', () => {
  controller?.stop();
  if (process.platform !== 'darwin') app.quit();
});
