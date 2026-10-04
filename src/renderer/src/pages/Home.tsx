import { useState } from 'react';
import { useAppStore } from '../store';
import { SPEECH_PROVIDERS, TEXT_PROVIDERS } from '../../../shared/types';

function Dot({ ok }: { ok: boolean }) {
  return <span className={`home-dot ${ok ? 'ok' : 'bad'}`} />;
}

export function Home() {
  const settings = useAppStore((s) => s.settings);
  const setPage = useAppStore((s) => s.setPage);
  const markStarted = useAppStore((s) => s.markStarted);
  const [blocked, setBlocked] = useState(false);

  const speechReady = Boolean(settings.volcApiKey.trim());
  const textPreset = TEXT_PROVIDERS.find((p) => p.id === settings.textProvider);
  const textReady = textPreset?.needsKey
    ? Boolean(settings.textApiKeys[settings.textProvider]?.trim())
    : true;
  const ready = speechReady && textReady;
  const speechLabel = SPEECH_PROVIDERS.find((p) => p.id === settings.speechProvider)?.label ?? '—';
  const textLabel = textPreset?.label ?? '—';

  async function start() {
    // Start is always the real pipeline; refusing to fake it with the demo.
    if (!ready) {
      setBlocked(true);
      return;
    }
    await window.virgil.startSession();
    markStarted();
    setPage('live');
  }

  async function demo() {
    await window.virgil.startSession(true);
    markStarted();
    setPage('live');
  }

  return (
    <div className="home">
      <button className="home-demo" onClick={demo} title="脚本回放，用于快速看懂界面">
        演示模式
      </button>
      <div className="home-inner">
        <div className="home-hero">
          <div className="home-title">随时开会，Virgil 替你听着</div>
          <div className="home-sub">
            实时转录 · 分清谁在说 · 提醒该问什么 · 会后自动总结
          </div>
        </div>

        <div className="start-wrap">
          <button className={`start-btn ${ready ? '' : 'disabled'}`} onClick={start}>
            Start
          </button>
        </div>

        <div className="home-status">
          <button className="home-chip" onClick={() => setPage('settings')}>
            <Dot ok={speechReady} />
            <span className="home-chip-label">语音识别</span>
            <span className="home-chip-value">{speechReady ? speechLabel : '未配置'}</span>
          </button>
          <button className="home-chip" onClick={() => setPage('settings')}>
            <Dot ok={textReady} />
            <span className="home-chip-label">文字模型</span>
            <span className="home-chip-value">{textReady ? textLabel : '未配置'}</span>
          </button>
        </div>

        {(!ready || blocked) && (
          <div className="home-warn">
            {blocked ? '还没配置好，Start 已停止：' : '还没配置好：'}
            请先在 Settings 里填好 Key（Copilot 需要它），否则点 Start 不会有总结和建议。
            <button className="link-btn" style={{ marginLeft: 6 }} onClick={() => setPage('settings')}>
              去设置
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
