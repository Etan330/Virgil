import { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import type { CopilotCard } from '../../shared/types';

/** Renders the pending copilot cards only (compact, for the mini panel). */
function MiniCard({ card }: { card: CopilotCard }) {
  return (
    <div className={`copilot-card ${card.type} ${card.state} mini-card`}>
      <div className="card-head">
        {card.starred && (
          <svg viewBox="0 0 24 24" width="11" height="11" style={{ flex: '0 0 11px' }}>
            <path
              d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44 6.2 20.5l1.1-6.47L2.6 9.45l6.5-.95L12 2.6z"
              fill="#f5b301"
            />
          </svg>
        )}
        <span className="card-title">{card.title}</span>
        <span className={`tag ${card.type}`}>{card.type === 'need_to_ask' ? '该问' : '这么回'}</span>
      </div>
      <div className="card-suggest">{card.suggested_text}</div>
    </div>
  );
}

export function MiniSession() {
  const snapshot = useAppStore((s) => s.snapshot);
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const pendingCards = snapshot.cards.filter((c) => c.state === 'pending');
  const starredPending = pendingCards.filter((c) => c.starred);
  const ordered = [...starredPending, ...pendingCards.filter((c) => !c.starred)];

  // Pull the current snapshot once (panel may open mid-session), then keep
  // listening — without this subscription new cards never reach the panel.
  useEffect(() => {
    void window.virgil.lastSnapshot().then((snap) => {
      if (snap) setSnapshot(snap);
    });
    const off = window.virgil.onSnapshot(setSnapshot);
    return off;
  }, [setSnapshot]);

  // The session ended while collapsed (demo auto-end or End from elsewhere):
  // bring the main window back, the App-level effect lands it on History.
  const hadSessionRef = useRef(false);
  useEffect(() => {
    if (snapshot.sessionId) hadSessionRef.current = true;
    if (hadSessionRef.current && !snapshot.sessionId) {
      void window.virgil.restoreFromMini();
    }
  }, [snapshot.sessionId]);

  async function restore() {
    await window.virgil.restoreFromMini();
  }

  async function togglePause() {
    if (snapshot.paused) await window.virgil.resumeSession();
    else await window.virgil.pauseSession();
  }

  async function endSession() {
    await window.virgil.stopSession();
    await window.virgil.restoreFromMini();
  }

  const listening = snapshot.asrStatus === 'running' && !snapshot.paused;

  return (
    <div className="mini">
      <div className="mini-head">
        <span className="mini-title">Copilot</span>
        <span className={`mini-count ${pendingCards.length ? 'has' : ''}`}>
          {pendingCards.length}
        </span>
        <span className="spacer" />
        <button className="mini-btn" title="展开主界面" onClick={() => void restore()}>
          ⤢
        </button>
        <button
          className="mini-btn"
          title={snapshot.paused ? '继续' : '暂停'}
          onClick={() => void togglePause()}
        >
          {snapshot.paused ? '▶' : '❚❚'}
        </button>
        <button className="mini-btn danger" title="结束会话" onClick={() => void endSession()}>
          ■
        </button>
      </div>

      {snapshot.paused && <div className="mini-paused">已暂停 · 按 ▶ 继续</div>}

      <div className="mini-list">
        {ordered.length === 0 ? (
          <div className="empty">
            暂无待处理卡片。
            <br />
            对话中出现需要你追问或回应的内容时会出现在这里。
          </div>
        ) : (
          ordered.map((card) => <MiniCard key={card.id} card={card} />)
        )}
      </div>

      <div className="mini-foot">
        <span className={`dot ${listening ? 'ok' : ''}`} />
        <span>{listening ? '正在听' : snapshot.paused ? '已暂停' : '待机'}</span>
      </div>
    </div>
  );
}
