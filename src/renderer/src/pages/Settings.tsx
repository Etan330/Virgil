import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { AudioCapture } from '../audio/capture';
import {
  SPEECH_PROVIDERS,
  TEXT_PROVIDERS,
  type Settings,
  type SpeechProviderId,
  type TestResult,
  type TextProviderId,
} from '../../../shared/types';

const VP_SENTENCE = '今天天气真好，早上出门的时候阳光很暖和，路上还看到几只麻雀在树上跳来跳去。';
const VP_MIN_SEC = 5;
const VP_MAX_SEC = 15;

export function Settings() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

  const [draft, setDraft] = useState<Settings>(settings);
  const [volcTest, setVolcTest] = useState<TestResult | null>(null);
  const [textTest, setTextTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState<'volc' | 'text' | null>(null);
  const [saved, setSaved] = useState('');

  const [vpEnrolled, setVpEnrolled] = useState<boolean | null>(null);
  const [vpRecording, setVpRecording] = useState(false);
  const [vpElapsed, setVpElapsed] = useState(0);
  const [vpLevels, setVpLevels] = useState<number[]>(() => new Array(32).fill(0.06));
  const [vpMsg, setVpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const vpCaptureRef = useRef<AudioCapture | null>(null);
  const vpChunksRef = useRef<ArrayBuffer[]>([]);
  const vpTimerRef = useRef<number | null>(null);

  const text = TEXT_PROVIDERS.find((p) => p.id === draft.textProvider)!;
  const speech = SPEECH_PROVIDERS.find((p) => p.id === draft.speechProvider)!;

  useEffect(() => {
    void window.virgil.voiceprintList().then((list) => setVpEnrolled(list.length > 0));
    return () => {
      vpCaptureRef.current?.stop();
      if (vpTimerRef.current) window.clearInterval(vpTimerRef.current);
    };
  }, []);

  function setTextProvider(id: TextProviderId) {
    setTextTest(null);
    setDraft({ ...draft, textProvider: id });
  }

  function setTextKey(value: string) {
    setDraft({
      ...draft,
      textApiKeys: { ...draft.textApiKeys, [draft.textProvider]: value },
    });
  }

  function setTextModel(value: string) {
    setDraft({ ...draft, textModels: { ...draft.textModels, [draft.textProvider]: value } });
  }

  async function testVolc() {
    setTesting('volc');
    setVolcTest(null);
    setVolcTest(await window.virgil.testVolc(draft.volcApiKey, draft.volcResourceId));
    setTesting(null);
  }

  async function testText() {
    setTesting('text');
    setTextTest(null);
    setTextTest(
      await window.virgil.testDeepSeek(
        draft.textApiKeys[draft.textProvider] ?? '',
        draft.textModels[draft.textProvider] ?? text.defaultModel,
        text.baseUrl,
      ),
    );
    setTesting(null);
  }

  async function save() {
    const next = await window.virgil.saveSettings(draft);
    setSettings(next);
    setSaved('已保存');
    setTimeout(() => setSaved(''), 2000);
  }

  /** ---------- 声纹内联录制 ---------- */
  function rms(pcm: ArrayBuffer): number {
    const view = new Int16Array(pcm);
    if (view.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < view.length; i += 16) sum += (view[i] / 32768) ** 2;
    return Math.min(1, Math.sqrt(sum / (view.length / 16)) * 4);
  }

  async function startVpRecording() {
    setVpMsg(null);
    setVpElapsed(0);
    vpChunksRef.current = [];
    setVpLevels(new Array(32).fill(0.06));
    const capture = new AudioCapture();
    vpCaptureRef.current = capture;
    try {
      await capture.start((pcm) => {
        vpChunksRef.current.push(pcm);
        const level = rms(pcm);
        setVpLevels((prev) => [...prev.slice(1), Math.max(0.06, level)]);
      });
      setVpRecording(true);
      const startedAt = Date.now();
      vpTimerRef.current = window.setInterval(() => {
        const sec = (Date.now() - startedAt) / 1000;
        setVpElapsed(sec);
        if (sec >= VP_MAX_SEC) void finishVpRecording();
      }, 100);
    } catch (err) {
      setVpMsg({ ok: false, text: `麦克风不可用：${(err as Error).message}` });
      vpCaptureRef.current = null;
    }
  }

  async function finishVpRecording() {
    if (vpTimerRef.current) {
      window.clearInterval(vpTimerRef.current);
      vpTimerRef.current = null;
    }
    vpCaptureRef.current?.stop();
    vpCaptureRef.current = null;
    setVpRecording(false);
    const total = vpChunksRef.current.reduce((n, c) => n + c.byteLength, 0);
    if (total < 16000 * 2 * VP_MIN_SEC) {
      setVpMsg({ ok: false, text: `太短了，至少要读 ${VP_MIN_SEC} 秒` });
      return;
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of vpChunksRef.current) {
      merged.set(new Uint8Array(c), off);
      off += c.byteLength;
    }
    const result = await window.virgil.voiceprintEnroll('我', merged.buffer);
    setVpEnrolled(result.enrolled);
    setVpMsg({ ok: result.ok, text: result.message });
  }

  async function removeProfile() {
    await window.virgil.voiceprintDelete('我');
    setVpEnrolled(false);
    setVpMsg(null);
  }

  const vpBusy = vpRecording;

  return (
    <div className="settings-wrap">
      <div className="settings-head">
        <div>
          <h2 className="page-title">Settings</h2>
          <div className="page-sub">左边配服务和 Key，右边登记你的声音。填完 Test 一遍再 Save。</div>
        </div>
        <div className="settings-head-actions">
          <span className="test-msg ok">{saved}</span>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>

      <div className="settings-grid">
        {/* ---------- 左栏：连接 ---------- */}
        <div className="card settings-panel">
          {/* 语音 */}
          <div className="section">
            <div className="section-head">
              <span className="section-num">1</span>
              <span className="section-title">语音识别 · 火山引擎</span>
              {draft.volcApiKey.trim() && <span className="badge on">已填 Key</span>}
            </div>
            <div className="pill-note">{speech.note}</div>
            <div className="field">
              <label>API Key</label>
              <input
                className="input"
                type="password"
                value={draft.volcApiKey}
                placeholder="火山引擎控制台 · API Key 管理"
                onChange={(e) => setDraft({ ...draft, volcApiKey: e.target.value })}
              />
              <button className="btn" disabled={testing === 'volc'} onClick={testVolc}>
                {testing === 'volc' ? '测试中…' : 'Test'}
              </button>
            </div>
            <div className="field">
              <label>Resource ID</label>
              <input
                className="input"
                value={draft.volcResourceId}
                onChange={(e) => setDraft({ ...draft, volcResourceId: e.target.value })}
              />
            </div>
            {volcTest && (
              <div className={`test-msg ${volcTest.ok ? 'ok' : 'err'}`}>{volcTest.message}</div>
            )}
          </div>

          {/* 文字 */}
          <div className="section">
            <div className="section-head">
              <span className="section-num">2</span>
              <span className="section-title">文字模型 · Copilot 大脑</span>
              {draft.textApiKeys[draft.textProvider]?.trim() && (
                <span className="badge on">已填 Key</span>
              )}
            </div>
            <div className="pill-list">
              {TEXT_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  className={`pill ${draft.textProvider === p.id ? 'active' : ''}`}
                  onClick={() => setTextProvider(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="pill-note">{text.note}</div>
            {text.needsKey && (
              <div className="field">
                <label>API Key</label>
                <input
                  className="input"
                  type="password"
                  value={draft.textApiKeys[draft.textProvider] ?? ''}
                  placeholder={`${text.label} 的 API Key`}
                  onChange={(e) => setTextKey(e.target.value)}
                />
                <button className="btn" disabled={testing === 'text'} onClick={testText}>
                  {testing === 'text' ? '测试中…' : 'Test'}
                </button>
              </div>
            )}
            <div className="field">
              <label>模型</label>
              <select
                className="input"
                value={draft.textModels[draft.textProvider] ?? text.defaultModel}
                onChange={(e) => setTextModel(e.target.value)}
              >
                {text.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {textTest && (
              <div className={`test-msg ${textTest.ok ? 'ok' : 'err'}`}>{textTest.message}</div>
            )}
          </div>
        </div>

        {/* ---------- 右栏：声纹 ---------- */}
        <div className={`card settings-panel vp-panel ${vpRecording ? 'recording' : ''}`}>
          <div className="section-head">
            <span className="section-num">3</span>
            <span className="section-title">声纹登记 · 分清「我和 TA」</span>
            {vpEnrolled && !vpRecording && <span className="badge on">已登记 ✓</span>}
            {vpRecording && <span className="badge on">录音中…</span>}
          </div>
          <div className="pill-note">
            点开始后照着句子读，Virgil 记住你的声音。之后每句话自动比对：像你的标「我」，不像的按声音自动分成「TA / TA2 / …」。声纹只保存在本机。
          </div>

          <div className="vp-visual">
            {vpLevels.map((l, i) => (
              <span key={i} style={{ height: `${Math.round(Math.max(8, l * 100))}%` }} />
            ))}
          </div>
          <div className="vp-sentence-inline">「{VP_SENTENCE}」</div>
          <ul className="vp-tips">
            <li>用平时开会、打电话的自然语速读</li>
            <li>安静环境，离麦克风 15–30 厘米</li>
            <li>读满 {VP_MIN_SEC} 秒，最长 {VP_MAX_SEC} 秒</li>
          </ul>

          <div className="vp-panel-foot">
            {vpRecording ? (
              <>
                <span className="vp-elapsed">
                  {vpElapsed.toFixed(1)}s{vpElapsed < VP_MIN_SEC ? `（至少 ${VP_MIN_SEC} 秒）` : ''}
                </span>
                <button
                  className="btn primary"
                  disabled={vpElapsed < VP_MIN_SEC}
                  onClick={() => void finishVpRecording()}
                >
                  {vpElapsed < VP_MIN_SEC ? '请继续读…' : '完成'}
                </button>
              </>
            ) : vpEnrolled ? (
              <>
                <button className="btn" onClick={() => void startVpRecording()}>
                  重新登记
                </button>
                <button className="btn danger" onClick={() => void removeProfile()}>
                  删除
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={() => void startVpRecording()}>
                开始录音
              </button>
            )}
          </div>
          {vpMsg && <div className={`test-msg ${vpMsg.ok ? 'ok' : 'err'}`}>{vpMsg.text}</div>}
          {!vpEnrolled && !vpRecording && !vpMsg && (
            <div className="test-msg">未登记：转录将退回停顿猜测分人</div>
          )}
        </div>
      </div>
    </div>
  );
}
