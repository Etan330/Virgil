// Offline smoke test: no Electron, no network.
// Verifies the Volcengine binary framing byte-by-byte and the demo Copilot loop.

import { gunzipSync } from 'node:zlib';
import {
  buildAudioRequest,
  buildFullClientRequest,
  MSG_AUDIO_ONLY_REQUEST,
  MSG_FULL_CLIENT_REQUEST,
  MSG_FULL_SERVER_RESPONSE,
  parseAsrResult,
  parseServerFrame,
} from '../src/main/services/volcProtocol';
import { DeepSeekAiService, MockAiService } from '../src/main/services/ai';
import { MockAsrDriver } from '../src/main/services/mockAsr';
import { DEMO_SCRIPT } from '../src/main/services/demoScript';
import type { CopilotCard } from '../src/shared/types';

let failures = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n[1] full_client_request framing');
const params = { audio: { format: 'pcm', rate: 16000 } };
const full = buildFullClientRequest(params);
check('header byte0 = 0x11 (version 1, header size 4B)', full[0] === 0x11, `got 0x${full[0].toString(16)}`);
check(
  'header byte1 = 0x10 (full client request, no sequence)',
  full[1] === (MSG_FULL_CLIENT_REQUEST << 4),
  `got 0x${full[1].toString(16)}`,
);
check('header byte2 = 0x11 (JSON + gzip)', full[2] === 0x11, `got 0x${full[2].toString(16)}`);
check('header byte3 reserved = 0x00', full[3] === 0x00);
const fullSize = full.readUInt32BE(4);
check('payload size matches gzip length', fullSize === full.length - 8, `${fullSize} vs ${full.length - 8}`);
check(
  'gzip payload decodes to the original JSON',
  gunzipSync(full.subarray(8)).toString('utf8') === JSON.stringify(params),
);

console.log('\n[2] audio_only_request framing');
const pcm = Buffer.alloc(3200 * 2, 1);
const audio = buildAudioRequest(pcm, false);
check(
  'header byte1 = 0x20 (audio only, not last)',
  audio[1] === (MSG_AUDIO_ONLY_REQUEST << 4),
  `got 0x${audio[1].toString(16)}`,
);
check('header byte2 = 0x01 (no serialization + gzip)', audio[2] === 0x01, `got 0x${audio[2].toString(16)}`);
check('audio payload size matches', audio.readUInt32BE(4) === audio.length - 8);
check('audio payload gunzips back to the pcm bytes', gunzipSync(audio.subarray(8)).equals(pcm));
const last = buildAudioRequest(pcm, true);
check('last packet flag = 0x2', (last[1] & 0x0f) === 0x2, `got flag ${last[1] & 0x0f}`);

console.log('\n[3] server response parsing');
const serverJson = JSON.stringify({
  result: {
    text: '这是字节跳动',
    utterances: [{ text: '这是字节跳动', definite: true, start_time: 0, end_time: 1705 }],
  },
});
const serverPayload = Buffer.from(serverJson, 'utf8');
const serverFrame = Buffer.concat([
  Buffer.from([
    0x11,
    (MSG_FULL_SERVER_RESPONSE << 4) | 0x1,
    0x11,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
  ]),
  (() => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(serverPayload.length, 0);
    return size;
  })(),
  serverPayload,
]);
const parsed = parseServerFrame(serverFrame);
check('message type is full server response', parsed.messageType === MSG_FULL_SERVER_RESPONSE);
check('sequence parsed as 1', parsed.sequence === 1, `got ${parsed.sequence}`);
const result = parseAsrResult(parsed.payload!);
check('utterance text parsed', result?.utterances?.[0]?.text === '这是字节跳动');
check('definite flag parsed', result?.utterances?.[0]?.definite === true);

console.log('\n[4] error frame parsing');
const errorFrame = Buffer.concat([
  Buffer.from([0x11, 0xf0, 0x10, 0x00]),
  (() => {
    const b = Buffer.alloc(8);
    b.writeUInt32BE(45000001, 0);
    b.writeUInt32BE(4, 4);
    return b;
  })(),
  Buffer.from('bad!!', 'utf8'),
]);
const errParsed = parseServerFrame(errorFrame);
check('error code parsed', errParsed.errorCode === 45000001, `got ${errParsed.errorCode}`);
check('error message parsed', errParsed.errorMessage === 'bad!');

console.log('\n[5] mock ASR driver emits final segments');
const finals: string[] = [];
const driver = new MockAsrDriver({
  onStatus: () => undefined,
  onPartial: () => undefined,
  onFinal: (seg) => finals.push(seg.text),
});
driver.start();
await new Promise((r) => setTimeout(r, 2600));
driver.stop();
check('at least one final segment emitted', finals.length >= 1, `got ${finals.length}`);
check('first line matches script', finals[0] === DEMO_SCRIPT[0].text);

console.log('\n[6] mock Copilot loop: card -> confirmed');
const mockAi = new MockAiService();
const first = await mockAi.analyze({ transcriptTail: DEMO_SCRIPT[0].text, summarySoFar: [], pendingCards: [] });
check('produces a need_to_ask card', first.newCards.some((c) => c.type === 'need_to_ask'));
check('produces a suggested_reply card', first.newCards.some((c) => c.type === 'suggested_reply'));

const pending: CopilotCard[] = first.newCards.map((c, i) => ({
  id: `card-${i}`,
  type: c.type,
  title: c.title,
  context: c.context,
  suggested_text: c.suggested_text,
  state: 'pending',
  created_at: new Date().toISOString(),
  resolved_at: null,
}));
// Step through lines 2 and 3: the user asks the question, so the card confirms.
await mockAi.analyze({ transcriptTail: DEMO_SCRIPT[1].text, summarySoFar: first.summary, pendingCards: pending });
const third = await mockAi.analyze({
  transcriptTail: DEMO_SCRIPT[2].text,
  summarySoFar: first.summary,
  pendingCards: pending,
});
const askCard = pending.find((c) => c.title === '确认奖励发放形式');
const resolution = third.resolutions.find((r) => r.card_id === askCard?.id);
check('pending card resolved to confirmed', resolution?.state === 'confirmed', JSON.stringify(third.resolutions));
check('resolve reason is user_asked', resolution?.reason === 'user_asked');
check('summary updated', third.summary.length > 0);

console.log('\n[7] real AI parser rejects incomplete or unsupported card resolutions');
const originalFetch = globalThis.fetch;
try {
  const cases: Array<{ name: string; raw: Record<string, unknown>; accepted: boolean; cardType?: CopilotCard['type'] }> = [
    { name: 'missing state and reason stay pending', raw: { card_id: 'card-0' }, accepted: false },
    { name: 'unknown state stays pending', raw: { card_id: 'card-0', state: 'maybe', reason: 'user_asked' }, accepted: false },
    { name: 'unknown reason stays pending', raw: { card_id: 'card-0', state: 'confirmed', reason: 'unclear' }, accepted: false },
    { name: 'expired resolution stays pending', raw: { card_id: 'card-0', state: 'dismissed', reason: 'expired' }, accepted: false },
    { name: 'missing evidence stays pending', raw: { card_id: 'card-0', state: 'confirmed', reason: 'user_asked' }, accepted: false },
    { name: 'unknown speaker cannot confirm an answer even with known speakers elsewhere', raw: { card_id: 'card-0', state: 'confirmed', reason: 'answered_by_counterpart', evidence_segment_idx: 1 }, accepted: false },
    { name: 'user utterance cannot confirm counterpart answer', raw: { card_id: 'card-0', state: 'confirmed', reason: 'answered_by_counterpart', evidence_segment_idx: 2 }, accepted: false },
    { name: 'counterpart utterance cannot confirm user question', raw: { card_id: 'card-0', state: 'confirmed', reason: 'user_asked', evidence_segment_idx: 3 }, accepted: false },
    { name: 'nonexistent evidence stays pending', raw: { card_id: 'card-0', state: 'confirmed', reason: 'user_asked', evidence_segment_idx: 999 }, accepted: false },
    { name: 'string evidence identifier stays pending', raw: { card_id: 'card-0', state: 'confirmed', reason: 'user_asked', evidence_segment_idx: '0' }, accepted: false },
    { name: 'explicit user question is accepted', raw: { card_id: 'card-0', state: 'confirmed', reason: 'user_asked', evidence_segment_idx: 0 }, accepted: true },
    { name: 'explicit counterpart answer is accepted', raw: { card_id: 'card-0', state: 'confirmed', reason: 'answered_by_counterpart', evidence_segment_idx: 0 }, accepted: true },
    { name: 'explicit user reply is accepted for a reply card', cardType: 'suggested_reply', raw: { card_id: 'card-0', state: 'confirmed', reason: 'user_replied', evidence_segment_idx: 4 }, accepted: true },
    { name: 'counterpart cannot confirm a user reply card', cardType: 'suggested_reply', raw: { card_id: 'card-0', state: 'confirmed', reason: 'user_replied', evidence_segment_idx: 5 }, accepted: false },
    { name: 'counterpart answer cannot resolve a reply card', cardType: 'suggested_reply', raw: { card_id: 'card-0', state: 'confirmed', reason: 'answered_by_counterpart', evidence_segment_idx: 5 }, accepted: false },
    { name: 'user question cannot resolve a reply card', cardType: 'suggested_reply', raw: { card_id: 'card-0', state: 'confirmed', reason: 'user_asked', evidence_segment_idx: 0 }, accepted: false },
    { name: 'user reply cannot resolve a question card', raw: { card_id: 'card-0', state: 'confirmed', reason: 'user_replied', evidence_segment_idx: 4 }, accepted: false },
  ];
  for (const test of cases) {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary: [], new_cards: [], resolutions: [test.raw] }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const service = new DeepSeekAiService('test-placeholder', 'test-model', 'https://test.invalid');
    const contextSegments = [
      { idx: 0, speaker: test.name === 'explicit counterpart answer is accepted' ? 'TA' : '我', text: test.name === 'explicit counterpart answer is accepted' ? '这个需求由王莉负责。' : '谁负责这个需求？' },
      { idx: 1, speaker: null, text: '[TA] 这个需求由王莉负责。' },
      { idx: 2, speaker: '我', text: '谁负责这个需求？' },
      { idx: 3, speaker: 'TA', text: '谁负责这个需求？' },
      { idx: 4, speaker: '我', text: '我先核对剩余工时，再回复你是否接。' },
      { idx: 5, speaker: 'TA', text: '我先核对剩余工时，再回复你是否接。' },
    ];
    const testCards = pending.map((card) => card.id === 'card-0' && test.cardType ? { ...card, type: test.cardType } : card);
    const result = await service.analyze({ transcriptTail: '[我] 谁负责这个需求？', contextSegments, summarySoFar: [], pendingCards: testCards });
    check(test.name, result.resolutions.length === (test.accepted ? 1 : 0));
  }

  let outbound = '';
  globalThis.fetch = async (_url, init) => {
    outbound = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":[],"new_cards":[],"resolutions":[]}' } }] }), { status: 200 });
  };
  const historyInput = { transcriptTail: '[TA] 现在确认验收。', contextSegments: [{ idx: 50, speaker: 'TA', text: '现在确认验收。' }], summarySoFar: ['【待办】王莉负责，下周五上线'], pendingCards: [] };
  Object.assign(historyInput, { recentCards: [{ id: 'old-owner', type: 'need_to_ask', title: '确认负责人', suggested_text: '谁负责？', state: 'confirmed', resolve_reason: 'user_asked' }] });
  await new DeepSeekAiService('test-placeholder', 'test-model', 'https://test.invalid').analyze(historyInput);
  const userPrompt = JSON.parse(outbound).messages.find((message: { role: string }) => message.role === 'user')?.content ?? '';
  check('earlier summary reaches the real model request', userPrompt.includes('王莉负责，下周五上线'));
  check('handled card context reaches the real model request', userPrompt.includes('old-owner') && userPrompt.includes('user_asked'));
} finally {
  globalThis.fetch = originalFetch;
}

console.log('\n[8] scripted demo resolution roles match the displayed conversation');
for (const line of DEMO_SCRIPT) {
  for (const resolution of line.resolves ?? []) {
    check(`demo resolution role: ${resolution.title}`, resolution.reason === 'answered_by_counterpart' ? line.speaker !== '我' : line.speaker === '我');
  }
}

console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
