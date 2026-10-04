// Headless regression check for the session state machine.
// No Electron, no network: the demo (mock) driver stands in for live ASR/AI.
//
// These cover bugs found in the 2026-10-03 review, so they do not come back:
//   1. starting a session while one is running must not orphan the old one
//   2. a stop that overlaps a start must not write into the sessions root
//   3. concurrent stop() calls must be idempotent
//   4. PCM buffered for one utterance must stay bounded when no final arrives
//
// Run: npm run check:state

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { SessionController } from '../src/main/sessionController';
import { appendSegments, loadSession } from '../src/main/store/sessions';
import type { AiInput, AiLike } from '../src/main/services/ai';
import type { CopilotCard, Settings, TranscriptSegment } from '../src/shared/types';

const SESSIONS = join(app.getPath('userData'), 'sessions');
const CHUNK = Buffer.alloc(3200 * 2); // 200ms of 16k/16bit/mono

const SETTINGS: Settings = {
  speechProvider: 'volc',
  volcApiKey: '',
  volcResourceId: 'volc.seedasr.sauc.duration',
  textProvider: 'glm',
  textApiKeys: { deepseek: '', glm: '', siliconflow: '' },
  textModels: {
    deepseek: 'deepseek-chat',
    glm: 'glm-4.7-flash',
    siliconflow: 'Qwen2.5-7B-Instruct',
  },
  language: 'zh-CN',
};

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail = ''): void {
  checks += 1;
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function survives(name: string, fn: () => void): void {
  checks += 1;
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name} 抛异常 — ${(err as Error).message}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function fresh(): void {
  rmSync(SESSIONS, { recursive: true, force: true });
  mkdirSync(SESSIONS, { recursive: true });
}

function dirs(): string[] {
  return existsSync(SESSIONS) ? readdirSync(SESSIONS).sort() : [];
}

/** Anything at the sessions root (not inside a <uuid>/ dir) is stray data. */
function strayRootFiles(): string[] {
  return dirs().filter((n) => {
    const p = join(SESSIONS, n);
    return existsSync(p) && statSync(p).isFile();
  });
}

function unfinished(): Array<{ id: string; title: string }> {
  return dirs()
    .filter((id) => {
      const p = join(SESSIONS, id, 'session.json');
      if (!existsSync(p)) return false;
      try {
        return (JSON.parse(readFileSync(p, 'utf8')).meta?.ended_at ?? null) === null;
      } catch {
        return false;
      }
    })
    .map((id) => {
      const p = join(SESSIONS, id, 'session.json');
      try {
        return { id: id.slice(0, 8), title: JSON.parse(readFileSync(p, 'utf8')).meta.title };
      } catch {
        return { id: id.slice(0, 8), title: '??' };
      }
    });
}

console.log('\n[1] 未启动就操作：不能抛异常');
fresh();
const c0 = new SessionController(() => undefined);
survives('pause / resume / feedPcm / dismissCard / starCard', () => {
  c0.pause();
  c0.resume();
  c0.feedPcm(CHUNK);
  c0.dismissCard('x');
  c0.starCard('x');
});
ok('未启动时 isRunning() 为 false', c0.isRunning() === false);
void c0.stop();

console.log('\n[2] 演示模式完整一轮：转录 / 总结 / 卡片 / 标题都要落盘');
fresh();
const c1 = new SessionController(() => undefined);
const id1 = await c1.start(SETTINGS, true);
await sleep(7000); // 第一句约 2.1s + AI debounce 2.5s + mock AI 0.6s
await c1.stop();
const rec = JSON.parse(readFileSync(join(SESSIONS, id1, 'session.json'), 'utf8'));
ok('session.json 已结束（ended_at）', Boolean(rec.meta.ended_at));
ok('duration_ms > 0', rec.meta.duration_ms > 0);
ok('演示标题已写入', String(rec.meta.title).startsWith('演示'), rec.meta.title);
ok('总结已落盘', (rec.summary ?? []).length > 0);
ok('Copilot 卡片已落盘', (rec.cards ?? []).length > 0);
ok(
  '转录已写入 ndjson',
  existsSync(join(SESSIONS, id1, 'transcript.ndjson')) &&
    readFileSync(join(SESSIONS, id1, 'transcript.ndjson'), 'utf8').split('\n').filter(Boolean)
      .length > 0,
);

// 演示模式必须与真实会话长得一样：History 里要有播放器，点某句能跳到对应位置。
const wavPath = join(SESSIONS, id1, 'audio.wav');
ok('演示会话也有录音文件', existsSync(wavPath));
if (existsSync(wavPath)) {
  const size = statSync(wavPath).size;
  const head = readFileSync(wavPath).subarray(0, 44);
  const seconds = (size - 44) / 32000;
  ok('wav 头合法（RIFF/WAVE/fmt）', head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE' && head.toString('ascii', 12, 16) === 'fmt ');
  ok('wav 长度字段与文件一致', head.readUInt32LE(4) === size - 8 && head.readUInt32LE(40) === size - 44);
  ok('录音时长覆盖到最后一句', seconds * 1000 >= Math.max(...rec.transcript.map((s) => s.end_ms)), `${seconds.toFixed(1)}s`);
  ok('每句转录都能对应到录音内的时间点', rec.transcript.every((s) => s.start_ms >= 0 && s.start_ms < seconds * 1000));
}

console.log('\n[3] 会话进行中再次 Start：旧会话不能变成孤儿');
fresh();
const c2 = new SessionController(() => undefined);
const first = await c2.start(SETTINGS, true);
await sleep(2500);
const second = await c2.start(SETTINGS, true);
await sleep(2500);
await c2.stop();
ok('两场会话都正常收尾', unfinished().length === 0, JSON.stringify(unfinished()));
ok('第一场 ended_at 已写入', Boolean(JSON.parse(readFileSync(join(SESSIONS, first, 'session.json'), 'utf8')).meta.ended_at));
ok('第二场是新的 sessionId', second !== first);
ok('没有游离在 sessions 根目录的文件', strayRootFiles().length === 0, JSON.stringify(strayRootFiles()));

console.log('\n[4] 并发两次 stop：必须幂等');
fresh();
const c3 = new SessionController(() => undefined);
await c3.start(SETTINGS, true);
await sleep(2600);
const both = await Promise.all([c3.stop(), c3.stop()]);
ok('两次都返回同一个结果（不重复收尾）', JSON.stringify(both[0]) === JSON.stringify(both[1]), JSON.stringify(both));
ok('只有一场会话且已结束', dirs().length === 1 && unfinished().length === 0, JSON.stringify(dirs()));

console.log('\n[5] stop 尚未 resolve 就立刻 start');
fresh();
const c4 = new SessionController(() => undefined);
await c4.start(SETTINGS, true);
await sleep(2600);
const stopPromise = c4.stop();
const newId = await c4.start(SETTINGS, true);
await stopPromise;
await sleep(2600);
await c4.stop();
ok('没有会话卡在未结束状态', unfinished().length === 0, JSON.stringify(unfinished()));
ok('新会话 id 有效', typeof newId === 'string' && newId.length > 10);
ok('没有游离在 sessions 根目录的文件', strayRootFiles().length === 0, JSON.stringify(strayRootFiles()));

console.log('\n[6] 暂停 / 继续滥用 + 非法卡片 id');
fresh();
const c5 = new SessionController(() => undefined);
await c5.start(SETTINGS, true);
await sleep(1400);
c5.pause();
c5.pause();
c5.resume();
c5.resume();
c5.pause();
c5.feedPcm(CHUNK);
c5.dismissCard('x');
c5.starCard('x');
await sleep(200);
c5.resume();
await sleep(6000);
ok('滥用暂停后仍能正常结束', (await c5.stop()) !== null);
ok('只有一场会话且已结束', dirs().length === 1 && unfinished().length === 0, JSON.stringify(dirs()));

console.log('\n[7] ASR 一直不出 final：缓冲区必须有上限');
fresh();
const c6 = new SessionController(() => undefined);
await c6.start(SETTINGS, false);
const before = process.memoryUsage().external;
for (let i = 0; i < 18000; i += 1) c6.feedPcm(CHUNK); // 1 小时音频
const grownMb = (process.memoryUsage().external - before) / 1024 / 1024;
ok('喂 1 小时音频后额外内存 < 60MB', grownMb < 60, `实际 +${grownMb.toFixed(1)}MB`);
void c6.stop();

console.log('\n[8] AI context preserves speaker identity and whole recent utterances');
const contextController = new SessionController(() => undefined);
const contextAccess = contextController as unknown as {
  segments: Array<{ text: string; speaker: string | null }>;
  transcriptTail(): string;
};
contextAccess.segments = [{ text: '谁负责这个需求？', speaker: '我' }];
const userQuestionContext = contextAccess.transcriptTail();
contextAccess.segments = [{ text: '谁负责这个需求？', speaker: 'TA' }];
const counterpartQuestionContext = contextAccess.transcriptTail();
ok('同一句问题由不同人说出时模型输入不同', userQuestionContext !== counterpartQuestionContext);
ok('用户和对方标签保留到模型输入', userQuestionContext.includes('[我]') && counterpartQuestionContext.includes('[TA]'));
contextAccess.segments = [{ text: '下周确认。', speaker: null }];
ok('未知说话人不冒充用户或对方', contextAccess.transcriptTail().includes('[未知]'));
contextAccess.segments = [
  { text: '旧'.repeat(7990), speaker: '我' },
  { text: '最后一句必须保留完整。', speaker: 'TA2' },
];
const recentContext = contextAccess.transcriptTail();
ok('窗口裁剪不留下半句及丢失的说话人标签', recentContext === '[TA2] 最后一句必须保留完整。');

console.log('\n[9] live analysis passes indexed context and persists the evidence reference');
const evidenceController = new SessionController(() => undefined);
const evidenceSession = await evidenceController.start(SETTINGS, true);
evidenceController.pause();
const evidenceAccess = evidenceController as unknown as {
  segments: TranscriptSegment[];
  cards: CopilotCard[];
  ai: AiLike;
  runAnalyze(): Promise<void>;
};
evidenceAccess.segments = [{ idx: 42, text: '这个需求由王莉负责。', speaker: 'TA', start_ms: 0, end_ms: 1000, definitive: true }];
appendSegments(evidenceSession, evidenceAccess.segments);
evidenceAccess.cards = [{ id: 'owner', type: 'need_to_ask', title: '确认负责人', context: '', suggested_text: '谁负责这个需求？', state: 'pending', created_at: new Date().toISOString(), resolved_at: null }];
evidenceAccess.cards.push({ id: 'already-asked', type: 'need_to_ask', title: '确认日期', context: '', suggested_text: '哪天上线？', state: 'confirmed', created_at: new Date().toISOString(), resolved_at: new Date().toISOString(), resolve_reason: 'user_asked' });
const capturedInputs: AiInput[] = [];
evidenceAccess.ai = { analyze: async (input) => {
  capturedInputs.push(input);
  return { summary: [], newCards: [], resolutions: [{ card_id: 'owner', state: 'confirmed', reason: 'answered_by_counterpart', evidence_segment_idx: 42 }], expiredCardIds: [] };
} };
await evidenceAccess.runAnalyze();
ok('真实编排向模型传入语句索引和说话人', capturedInputs[0]?.contextSegments?.[0]?.idx === 42 && capturedInputs[0]?.contextSegments?.[0]?.speaker === 'TA');
ok('真实编排传入已处理卡片且保留问过的区别', capturedInputs[0]?.recentCards?.[0]?.id === 'already-asked' && capturedInputs[0]?.recentCards?.[0]?.resolve_reason === 'user_asked');
const evidenceRecord = JSON.parse(readFileSync(join(SESSIONS, evidenceSession, 'session.json'), 'utf8'));
ok('确认依据索引随卡片持久化', evidenceRecord.cards?.[0]?.resolve_segment_idx === 42);
const evidenceHistory = loadSession(evidenceSession);
ok('历史加载后的确认索引可找到对应原文', evidenceHistory?.transcript.find((segment) => segment.idx === evidenceHistory.cards[0]?.resolve_segment_idx)?.text === '这个需求由王莉负责。');
await evidenceController.stop();

console.log(failures === 0 ? '\nALL STATE CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
