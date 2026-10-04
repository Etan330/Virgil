// Shared append-only file logger with simple size rotation.
// When a log file grows past LOG_MAX_BYTES it is renamed to <name>.old.log
// (replacing the previous one) so logs can never grow without bound.

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

const LOG_MAX_BYTES = 5 * 1024 * 1024;

export function appendLog(fileName: string, line: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, fileName);
    if (existsSync(path) && statSync(path).size > LOG_MAX_BYTES) {
      renameSync(path, path.replace(/\.log$/, '.old.log'));
    }
    appendFileSync(path, line, 'utf8');
  } catch {
    /* logging must never crash the app */
  }
}
