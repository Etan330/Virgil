import type { ServiceStatus } from '../../shared/types';
import { DEMO_SCRIPT } from './demoScript';
import type { AsrHandlers } from './asr';

/** Replays the scripted conversation as if it were live ASR output. */
export class MockAsrDriver {
  private timer: NodeJS.Timeout | null = null;
  private finalizeTimer: NodeJS.Timeout | null = null;
  private endTimer: NodeJS.Timeout | null = null;
  private index = 0;
  private stopped = false;

  constructor(private readonly handlers: AsrHandlers) {}

  start(): void {
    this.stopped = false;
    this.handlers.onStatus('running');
    this.scheduleNext(1200);
  }

  /** Real pause: freezes the replay, keeps position for resume(). */
  pause(): void {
    this.clearTimers();
    this.handlers.onStatus('stopped');
  }

  /** Continues from the frozen position. */
  resume(): void {
    if (this.stopped) return;
    this.handlers.onStatus('running');
    this.scheduleNext(1500);
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.finalizeTimer) clearTimeout(this.finalizeTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.timer = null;
    this.finalizeTimer = null;
    this.endTimer = null;
  }

  private scheduleNext(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.emitLine(), delay);
  }

  private emitLine(): void {
    if (this.stopped) return;
    // Loop the last line only when the script is exhausted; normally the
    // script simply ends and the session auto-closes via onEnded.
    const line = DEMO_SCRIPT[Math.min(this.index, DEMO_SCRIPT.length - 1)];
    const isLast = this.index >= DEMO_SCRIPT.length - 1;
    this.index += 1;
    this.handlers.onPartial(line.text);
    this.finalizeTimer = setTimeout(() => {
      if (this.stopped) return;
      this.handlers.onFinal({
        text: line.text,
        speaker: line.speaker,
        start_ms: this.index * 5000,
        end_ms: this.index * 5000 + 4000,
      });
      if (isLast) {
        // Let the final state linger briefly, then end the demo session.
        this.endTimer = setTimeout(() => {
          if (!this.stopped) this.handlers.onEnded?.();
        }, 4000);
      } else {
        this.scheduleNext(line.pauseMs ?? 6500);
      }
    }, 900);
  }

  feed(_pcm: Buffer): void {
    /* mock driver ignores real audio */
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.handlers.onStatus('stopped');
  }
}

export function statusFromError(message: string): ServiceStatus {
  return message ? 'error' : 'running';
}
