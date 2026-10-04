import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { AudioCapture } from '../audio/capture';
import { SpeakerBadge } from '../components/SpeakerBadge';
import type { CopilotCard } from '../../../shared/types';

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatSegmentTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function stateTag(card: CopilotCard) {
  if (card.state === 'confirmed') {
    const label =
      card.resolve_reason === 'user_asked'
        ? '已处理 · 你已问出'
        : card.resolve_reason === 'user_replied'
          ? '已处理 · 你已回应'
          : card.resolve_reason === 'answered_by_counterpart'
            ? '已处理 · 对方已回答'
            : '已处理';
    return <span className="tag confirmed">✓ {label}</span>;
  }
  if (card.state === 'dismissed') {
    const label = card.resolve_reason === 'user_dismissed' ? '已忽略' : '已过期';
    return (
      <span
        className="tag dismissed"
        title={
          card.resolve_reason === 'user_dismissed'
            ? '你手动忽略了这张卡片'
            : '这张卡片说的事情已经不需要了：话题已经过去，或超过 10 分钟没有解决'
        }
      >
        {label}
      </span>
    );
  }
  return <span className={`tag ${card.type}`}>{card.type === 'need_to_ask' ? '该问' : '这么回'}</span>;
}

export function LiveSession() {
  const snapshot = useAppStore((s) => s.snapshot);
  const startedAt = useAppStore((s) => s.startedAt);
  const [now, setNow] = useState(Date.now());
  const captureRef = useRef<AudioCapture | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Mic capture lifecycle: actually release the microphone while paused
  // (a "fake" pause leaves the mic hot and lets the ASR socket time out).
  useEffect(() => {
    if (!snapshot.sessionId || snapshot.mock) return;
    if (snapshot.paused) {
      captureRef.current?.stop();
      captureRef.current = null;
      return;
    }
    const capture = new AudioCapture();
    captureRef.current = capture;
    capture
      .start((pcm) => void window.virgil.sendPcm(pcm))
      .catch((err) => console.error('麦克风不可用', err));
    return () => {
      capture.stop();
      captureRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.sessionId, snapshot.paused]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot.segments.length, snapshot.partial]);

  async function end() {
    captureRef.current?.stop();
    captureRef.current = null;
    await window.virgil.stopSession();
  }

  // Clock excludes paused time: frozen while paused, ticking while running.
  const elapsed = startedAt
    ? Math.max(0, (snapshot.pausedAt ?? now) - startedAt - snapshot.pausedMs)
    : 0;
  const pendingCards = snapshot.cards.filter((c) => c.state === 'pending');
  const doneCards = snapshot.cards.filter((c) => c.state !== 'pending');

  return (
    <>
      <div className="live-head">
        <span className="timer">{formatClock(elapsed)}</span>
        <span className={`pill ${snapshot.asrStatus === 'running' ? 'ok' : ''}`}>
          听写 {snapshot.paused ? '已暂停' : statusText(snapshot.asrStatus)}
        </span>
        <span className={`pill ${snapshot.aiStatus === 'running' ? 'ok' : snapshot.aiStatus === 'error' ? 'err' : ''}`}>
          Copilot {statusText(snapshot.aiStatus)}
        </span>
        {snapshot.mock && <span className="pill demo">演示模式</span>}
        {snapshot.paused && <span className="pill paused">已暂停</span>}
        <span className="spacer" />
        <button
          className="btn"
          title="收起主界面，只保留 Copilot 悬浮窗"
          onClick={() => void window.virgil.collapseToMini()}
        >
          收起
        </button>
        <button
          className="btn"
          onClick={() =>
            snapshot.paused
              ? void window.virgil.resumeSession()
              : void window.virgil.pauseSession()
          }
        >
          {snapshot.paused ? '继续' : '暂停'}
        </button>
        <button className="btn danger" onClick={end}>
          End
        </button>
      </div>

      <div className="live-grid">
        <div className="live-left">
          <div className="card transcript" ref={scrollRef}>
            {snapshot.segments.length === 0 && !snapshot.partial && (
              <div className="empty">
                正在听…
                <br />
                说话后这里会实时出现文字
              </div>
            )}
            {snapshot.segments.map((seg) => (
              <div className="seg" key={seg.idx}>
                <span className="seg-dot" />
                {seg.speaker && <SpeakerBadge speaker={seg.speaker} />}
                <span className="seg-text">{seg.text}</span>
                <span className="seg-time">{formatSegmentTime(seg.start_ms)}</span>
              </div>
            ))}
            {snapshot.partial && <div className="partial">{snapshot.partial} …</div>}
          </div>

          <div className="card summary-box">
            <div className="section-label">实时总结</div>
            {snapshot.summary.length === 0 ? (
              <div className="empty" style={{ padding: '10px 0' }}>
                对话进行一会儿后，这里会持续更新要点
              </div>
            ) : (
              <ul className="summary-list">
                {snapshot.summary.map((line, i) => {
                  const m = line.match(/^【([^】]+)】\s*(.*)$/);
                  return (
                    <li key={i}>
                      {m && <span className="sum-tag" data-k={m[1]}>{m[1]}</span>}
                      {m ? m[2] : line}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="copilot-col">
          <div className="card copilot pending-box">
            <div className="section-label">待处理</div>
            {snapshot.asrError && (
              <div className="test-msg err">听写异常：{snapshot.asrError}</div>
            )}
            {snapshot.aiError && (
              <div className="test-msg err">Copilot 暂时不可用：{snapshot.aiError}</div>
            )}
            {pendingCards.length === 0 ? (
              <div className="empty">
                还在听。当对话里出现需要你追问或回应的信息点，卡片会出现在这里。
                <br />
                外放视频、闲聊这类没有明确信息点的内容不会产生卡片。
              </div>
            ) : (
              pendingCards.map(renderCard)
            )}
          </div>
          <div className="card copilot done-box">
            <div className="section-label">已处理</div>
            {doneCards.length === 0 ? (
              <div className="empty">处理过的卡片会移到这里</div>
            ) : (
              doneCards.map(renderCard)
            )}
          </div>
        </div>
      </div>
    </>
  );

  function renderCard(card: CopilotCard) {
    return (
      <div className={`copilot-card ${card.type} ${card.state}`} key={card.id}>
        <div className="card-head">
          <span className="card-title">{card.title}</span>
          {stateTag(card)}
          <span className="spacer" />
          <button
            className={`card-star ${card.starred ? 'on' : ''}`}
            title={card.starred ? '取消收藏' : '收藏，稍后回顾'}
            onClick={() => void window.virgil.starCard(card.id)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44 6.2 20.5l1.1-6.47L2.6 9.45l6.5-.95L12 2.6z"
                fill={card.starred ? '#f5b301' : 'none'}
                stroke={card.starred ? '#f5b301' : '#9aa0b4'}
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {card.state === 'pending' && (
            <button
              className="card-x"
              title="不需要"
              onClick={() => void window.virgil.dismissCard(card.id)}
            >
              ×
            </button>
          )}
        </div>
        <div className="card-suggest">{card.suggested_text}</div>
      </div>
    );
  }
}

function statusText(status: string): string {
  switch (status) {
    case 'running':
      return '正常';
    case 'connecting':
      return '连接中';
    case 'error':
      return '异常';
    case 'stopped':
      return '已停止';
    default:
      return '待启动';
  }
}
