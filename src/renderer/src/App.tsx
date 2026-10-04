import { useEffect, useRef } from 'react';
import { useAppStore, type Page } from './store';
import { Home } from './pages/Home';
import { LiveSession } from './pages/LiveSession';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import logo from './assets/logo.png';

const NAV: Array<{ key: Page; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'history', label: 'History' },
  { key: 'settings', label: 'Settings' },
];

export function App() {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const setSettings = useAppStore((s) => s.setSettings);
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const resetLive = useAppStore((s) => s.resetLive);
  const sessionId = useAppStore((s) => s.snapshot.sessionId);

  useEffect(() => {
    void window.virgil.getSettings().then(setSettings);
    const off = window.virgil.onSnapshot(setSnapshot);
    return off;
  }, [setSettings, setSnapshot]);

  // Session ended (user pressed End, or the demo script finished): land on
  // History so the summary and auto-title are immediately visible. Lives at
  // the App level because LiveSession unmounts as soon as sessionId clears.
  const prevSessionRef = useRef('');
  useEffect(() => {
    const prev = prevSessionRef.current;
    prevSessionRef.current = sessionId;
    if (prev && !sessionId) {
      void window.virgil.stopSession().catch(() => undefined);
      resetLive();
      setPage('history');
    }
  }, [sessionId, resetLive, setPage]);

  const active = sessionId && page === 'live' ? 'live' : page === 'live' ? 'home' : page;

  return (
    <div className="app">
      <div className="drag-strip" />
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={logo} alt="Virgil" />
          Virgil
        </div>
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${active === item.key ? 'active' : ''}`}
            onClick={() => setPage(item.key)}
          >
            {item.label}
          </button>
        ))}
        {sessionId && (
          <button
            className={`nav-item ${active === 'live' ? 'active' : ''}`}
            onClick={() => setPage('live')}
          >
            ● Live Session
          </button>
        )}
        <div className="sidebar-foot">听见 → 理解 → 提醒 → 沉淀</div>
      </aside>

      <main className="main">
        {active === 'live' ? (
          <LiveSession />
        ) : active === 'history' ? (
          <History />
        ) : active === 'settings' ? (
          <Settings />
        ) : (
          <Home />
        )}
      </main>
    </div>
  );
}
