import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import type { ServiceStatus } from '../../shared/types';
import {
  buildAudioRequest,
  buildFullClientRequest,
  MSG_ERROR_RESPONSE,
  MSG_FULL_SERVER_RESPONSE,
  parseAsrResult,
  parseServerFrame,
} from './volcProtocol';

export const VOLC_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

export interface AsrHandlers {
  onStatus: (status: ServiceStatus, error?: string) => void;
  onPartial: (text: string) => void;
  /** Mock driver also passes a scripted speaker; real ASR leaves it out. */
  onFinal: (segment: { text: string; start_ms: number; end_ms: number; speaker?: string }) => void;
  /** Mock driver only: the scripted conversation has finished playing. */
  onEnded?: () => void;
}

interface TrackedUtterance {
  text: string;
  definite: boolean;
  emitted: boolean;
  start_ms: number;
  end_ms: number;
}

export class VolcAsrService {
  private ws: WebSocket | null = null;
  private queue: Buffer[] = [];
  private ready = false;
  private stopped = false;
  private tracked: TrackedUtterance[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly resourceId: string,
    private readonly handlers: AsrHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    this.handlers.onStatus('connecting');
    const ws = new WebSocket(VOLC_WS_URL, {
      headers: {
        'X-Api-Key': this.apiKey,
        'X-Api-Resource-Id': this.resourceId || 'volc.seedasr.sauc.duration',
        'X-Api-Connect-Id': randomUUID(),
        'X-Api-Request-Id': randomUUID(),
        'X-Api-Sequence': '-1',
      },
      handshakeTimeout: 10_000,
    });
    this.ws = ws;

    ws.on('open', () => {
      ws.send(buildFullClientRequest(this.requestParams()));
      this.ready = true;
      this.handlers.onStatus('running');
      for (const chunk of this.queue.splice(0)) this.send(chunk, false);
    });

    ws.on('message', (data: Buffer) => this.onMessage(data));

    ws.on('error', (err: Error) => {
      this.handlers.onStatus('error', err.message || 'WebSocket 连接错误');
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.ready = false;
      if (this.stopped) {
        this.handlers.onStatus('stopped');
        return;
      }
      this.handlers.onStatus('error', `连接关闭 code=${code} ${reason?.toString() ?? ''}`.trim());
    });
  }

  private requestParams() {
    return {
      user: { uid: 'virgil-macos', platform: 'macOS', app_version: '0.1.0' },
      audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
      request: {
        model_name: 'bigmodel',
        show_utterances: true,
        result_type: 'full',
        enable_punc: true,
        enable_itn: true,
        enable_nonstream: true,
        end_window_size: 800,
        force_to_speech_time: 1000,
      },
    };
  }

  private onMessage(data: Buffer): void {
    const frame = parseServerFrame(Buffer.from(data as unknown as ArrayBuffer));
    if (frame.messageType === MSG_ERROR_RESPONSE) {
      this.handlers.onStatus('error', `ASR 错误 ${frame.errorCode}: ${frame.errorMessage}`);
      return;
    }
    if (frame.messageType !== MSG_FULL_SERVER_RESPONSE || !frame.payload) return;
    const result = parseAsrResult(frame.payload);
    if (!result) return;

    const utterances = result.utterances ?? [];
    if (utterances.length === 0 && result.text) {
      // Fallback: no utterance info, treat whole text as one live utterance.
      this.handlers.onPartial(result.text);
      return;
    }

    utterances.forEach((u, i) => {
      const text = (u.text ?? '').trim();
      if (!text) return;
      const prev = this.tracked[i];
      if (!prev) {
        this.tracked[i] = {
          text,
          definite: Boolean(u.definite),
          emitted: false,
          start_ms: u.start_time ?? 0,
          end_ms: u.end_time ?? 0,
        };
      } else {
        prev.text = text;
        prev.definite = Boolean(u.definite);
        prev.start_ms = u.start_time ?? prev.start_ms;
        prev.end_ms = u.end_time ?? prev.end_ms;
      }
      const current = this.tracked[i];
      if (!current.definite) {
        this.handlers.onPartial(text);
      } else if (!current.emitted) {
        current.emitted = true;
        this.handlers.onFinal({
          text,
          start_ms: current.start_ms,
          end_ms: current.end_ms,
        });
      }
    });
  }

  /** Feed 16kHz / 16bit / mono PCM. */
  feed(pcm: Buffer): void {
    if (this.stopped) return;
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(pcm);
      if (this.queue.length > 500) this.queue.shift();
      return;
    }
    this.send(pcm, false);
  }

  private send(pcm: Buffer, isLast: boolean): void {
    try {
      this.ws?.send(buildAudioRequest(pcm, isLast));
    } catch (err) {
      this.handlers.onStatus('error', (err as Error).message);
    }
  }

  stop(): void {
    this.stopped = true;
    this.ready = false;
    const ws = this.ws;
    if (!ws) {
      this.handlers.onStatus('stopped');
      return;
    }
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(buildAudioRequest(Buffer.alloc(0), true));
      setTimeout(() => ws.close(), 500);
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.handlers.onStatus('stopped');
  }
}
