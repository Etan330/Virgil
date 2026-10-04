// End-to-end check against a running Electron instance (--remote-debugging-port=9222).
// Drives the real UI over CDP: click Start, wait, then read what the user would see.

import WebSocket from 'ws';

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
if (!page) throw new Error('no renderer target found');

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0;
const pending = new Map();

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve) => {
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return res.result?.result?.value ?? res.result?.exceptionDetails?.text ?? '';
}

await new Promise((resolve) => ws.on('open', resolve));

// The app may have been left on any page (e.g. History after a demo
// auto-ended); Home is the required starting point.
await send('Runtime.evaluate', {
  expression: "[...document.querySelectorAll('.nav-item')].find(b => b.textContent === 'Home')?.click()",
  returnByValue: true,
});
await new Promise((r) => setTimeout(r, 600));

console.log('--- 初始界面 ---');
console.log(await evaluate('document.body.innerText'));

console.log('\n--- 点击右上角「演示模式」（与 Start 分离）---');
const hasDemoBtn = await evaluate("Boolean(document.querySelector('.home-demo'))");
const hasHomeLogo = await evaluate("Boolean(document.querySelector('.home-logo'))");
await evaluate("document.querySelector('.home-demo').click()");
await new Promise((r) => setTimeout(r, 14000));
const live = await evaluate('document.body.innerText');
console.log(live);

const checks = [
  ['演示按钮独立于 Start（右上角）', hasDemoBtn],
  ['Home 不再显示大 logo', !hasHomeLogo],
  ['进入 Live Session', live.includes('End')],
  ['标记为演示模式', live.includes('演示模式')],
  ['出现实时转录', live.includes('邀请好友')],
  ['出现实时总结', live.includes('实时总结') && live.includes('时间紧')],
  ['出现 Need to ask 卡片', live.includes('该问')],
  ['出现 Suggested reply 卡片', live.includes('这么回')],
  ['卡片已精简（不再显示 context 长解释）', !live.includes('决定后端的工作量')],
  ['卡片不再显示时间戳', !/\d{2}:\d{2}:\d{2}/.test(live)],
];
let failed = 0;
console.log('\n--- 判定 ---');
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}

console.log('\n--- 结束会话并检查 History ---');
await evaluate("[...document.querySelectorAll('.btn')].find(b => b.textContent === 'End').click()");
await new Promise((r) => setTimeout(r, 1500));
const history = await evaluate('document.body.innerText');
console.log(history);
// The session may now carry an AI-generated title, so check for the
// rename affordance rather than the default "会话 2026-…" string.
const historyOk = history.includes('✎');
console.log(`  ${historyOk ? 'PASS' : 'FAIL'}  会话写入 History`);
if (!historyOk) failed += 1;

console.log('\n--- 删除会话 ---');
const before = await evaluate("document.querySelectorAll('.session-item').length");
await evaluate("document.querySelectorAll('.icon-btn')[1].click()"); // 🗑 on first item
await new Promise((r) => setTimeout(r, 400));
const confirmVisible = await evaluate("!!document.querySelector('.confirm-row')");
await evaluate("[...document.querySelectorAll('.confirm-row .btn')].find(b => b.textContent === '删除').click()");
await new Promise((r) => setTimeout(r, 600));
const after = await evaluate("document.querySelectorAll('.session-item').length");
const deleteOk = confirmVisible && after === before - 1;
console.log(`  ${confirmVisible ? 'PASS' : 'FAIL'}  点击 🗑 弹出二次确认`);
console.log(`  ${after === before - 1 ? 'PASS' : 'FAIL'}  确认后会话被删除（${before} → ${after}）`);
if (!deleteOk) failed += 1;

console.log('\n--- Settings：供应商与声纹 ---');
await evaluate("[...document.querySelectorAll('.nav-item')].find(b => b.textContent === 'Settings').click()");
await new Promise((r) => setTimeout(r, 800));
const settingsText = await evaluate('document.body.innerText');
const speechOk =
  settingsText.includes('语音识别 · 火山引擎') && !settingsText.includes('本地离线');
const textOk =
  settingsText.includes('DeepSeek') &&
  settingsText.includes('智谱 GLM') &&
  settingsText.includes('硅基流动') &&
  !settingsText.includes('Ollama');
const vpOk = settingsText.includes('声纹登记');
const onePageOk = settingsText.includes('语音识别') && settingsText.includes('声纹登记');
console.log(`  ${speechOk ? 'PASS' : 'FAIL'}  语音只有火山云端（本地语音模块已移除）`);
console.log(`  ${textOk ? 'PASS' : 'FAIL'}  文字三家：DeepSeek / GLM / 硅基流动（无 Ollama）`);
console.log(`  ${vpOk ? 'PASS' : 'FAIL'}  声纹登记入口存在`);
console.log(`  ${onePageOk ? 'PASS' : 'FAIL'}  Settings 单页双栏（左配置 / 右声纹）`);
if (!speechOk || !textOk || !vpOk || !onePageOk) failed += 1;

console.log('\n--- 切到智谱后模型下拉跟着变 ---');
await evaluate("[...document.querySelectorAll('.pill')].find(b => b.textContent.includes('智谱 GLM')).click()");
await new Promise((r) => setTimeout(r, 600));
const models = await evaluate(
  "[...document.querySelectorAll('select.input option')].map(o => o.textContent).join(' | ')",
);
console.log(`  当前模型选项: ${models}`);
const modelOk = models.includes('glm-4.7-flash');
console.log(`  ${modelOk ? 'PASS' : 'FAIL'}  模型下拉跟随供应商（glm-4.7-flash）`);
if (!modelOk) failed += 1;

ws.close();
process.exit(failed === 0 ? 0 : 1);
