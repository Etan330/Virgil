import { useEffect, useRef, useState } from 'react';
import type { SearchHit, SessionMeta, SessionRecord } from '../../../shared/types';
import { SpeakerBadge } from '../components/SpeakerBadge';

function formatDuration(ms: number): string {
  if (!ms) return '—';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Custom, compact audio player: play/pause + scrub bar + clock. */
function AudioPlayer({
  src,
  onTime,
  seekRef,
}: {
  src: string;
  onTime: (sec: number) => void;
  seekRef: React.MutableRefObject<{ seekTo: (sec: number) => void } | null>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    seekRef.current = {
      seekTo: (sec: number) => {
        const a = audioRef.current;
        if (!a) return;
        a.currentTime = sec;
        void a.play();
      },
    };
  }, [seekRef]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  function scrub(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  }

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          setCurrent(e.currentTarget.currentTime);
          onTime(e.currentTarget.currentTime);
        }}
      />
      <button className="audio-play" onClick={toggle} title={playing ? '暂停' : '播放'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="audio-track" onClick={scrub}>
        <div
          className="audio-fill"
          style={{ width: duration ? `${(current / duration) * 100}%` : '0%' }}
        />
      </div>
      <span className="audio-clock">
        {formatClock(current)} / {formatClock(duration)}
      </span>
    </div>
  );
}

export function History() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const seekRef = useRef<{ seekTo: (sec: number) => void } | null>(null);
  const searchTimer = useRef<number | null>(null);

  async function refresh() {
    const list = await window.virgil.listSessions();
    setSessions(list);
    return list;
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selected) {
      setRecord(null);
      setActiveIdx(null);
      return;
    }
    void window.virgil.loadSession(selected).then((r) => {
      setRecord(r);
      setActiveIdx(null);
    });
  }, [selected]);

  // Debounced full-text search across sessions.
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void window.virgil.searchSessions(q).then(setHits);
    }, 300);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query]);

  function open(id: string) {
    setSelected(id);
  }

  function beginRename(meta: SessionMeta) {
    setEditingId(meta.id);
    setDraftTitle(meta.title);
  }

  async function commitRename() {
    if (!editingId) return;
    await window.virgil.renameSession(editingId, draftTitle);
    setEditingId(null);
    await refresh();
    if (selected === editingId) {
      const updated = await window.virgil.loadSession(editingId);
      setRecord(updated);
    }
  }

  async function remove(id: string) {
    await window.virgil.deleteSession(id);
    setConfirmingId(null);
    if (selected === id) {
      setSelected(null);
      setRecord(null);
    }
    await refresh();
  }

  /** Current-time callback: highlight the transcript line being played. */
  function onAudioTime(sec: number) {
    if (!record) return;
    const ms = sec * 1000;
    const hit = record.transcript.find((s) => ms >= s.start_ms - 200 && ms < s.end_ms + 200);
    setActiveIdx(hit ? hit.idx : null);
  }

  function seekToSegment(startMs: number) {
    seekRef.current?.seekTo(Math.max(0, startMs / 1000 - 0.2));
  }

  return (
    <>
      <div className="history-head">
        <div>
          <h2 className="page-title">History</h2>
          <div className="page-sub">过去的会话都在这里，可以回看完整记录。</div>
        </div>
        <input
          className="input search-input"
          placeholder="搜索标题、转录、总结、Copilot…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="history-grid">
        <div className="card session-list">
          {hits !== null ? (
            hits.length === 0 ? (
              <div className="empty">没有匹配「{query}」的内容</div>
            ) : (
              hits.map((hit) => (
                <div
                  key={`${hit.meta.id}-${hit.field}`}
                  className={`session-item ${selected === hit.meta.id ? 'active' : ''}`}
                  onClick={() => open(hit.meta.id)}
                >
                  <div className="session-title">
                    <span style={{ flex: 1 }}>{hit.meta.title}</span>
                    <span className="badge on">{hit.field}</span>
                  </div>
                  <div className="session-meta">{hit.snippet}</div>
                </div>
              ))
            )
          ) : (
            <>
              {sessions.length === 0 && <div className="empty">还没有会话记录</div>}
              {sessions.map((meta) => (
                <div
                  key={meta.id}
                  className={`session-item ${selected === meta.id ? 'active' : ''}`}
                  onClick={() => open(meta.id)}
                >
                  <div className="session-title">
                    {editingId === meta.id ? (
                      <input
                        className="rename-input"
                        value={draftTitle}
                        autoFocus
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span style={{ flex: 1 }}>{meta.title}</span>
                        <button
                          className="icon-btn"
                          title="重命名"
                          onClick={(e) => {
                            e.stopPropagation();
                            beginRename(meta);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          className="icon-btn"
                          title="删除"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmingId(meta.id);
                          }}
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                  <div className="session-meta">
                    {formatDate(meta.started_at)} · {formatDuration(meta.duration_ms)}
                  </div>
                  {confirmingId === meta.id && (
                    <div className="confirm-row" onClick={(e) => e.stopPropagation()}>
                      <span>删除这条会话？不可恢复。</span>
                      <button className="btn danger" onClick={() => void remove(meta.id)}>
                        删除
                      </button>
                      <button className="btn" onClick={() => setConfirmingId(null)}>
                        取消
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="card detail">
          {!record ? (
            <div className="empty">选择左侧任意一条会话查看记录</div>
          ) : (
            <>
              <div className="section-label">会话</div>
              <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 14 }}>
                {record.meta.title}
              </div>

              {record.audioPath && (
                <AudioPlayer
                  src={`file://${encodeURI(record.audioPath)}`}
                  onTime={onAudioTime}
                  seekRef={seekRef}
                />
              )}

              <div className="section-label">总结</div>
              {record.summary.length === 0 ? (
                <div className="empty" style={{ padding: '6px 0 14px' }}>
                  无
                </div>
              ) : (
                <ul className="summary-list">
                  {record.summary.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}

              <div className="section-label" style={{ marginTop: 16 }}>
                转录{record.audioPath ? '（点击某一句跳到录音对应位置）' : ''}
              </div>
              {record.transcript.length === 0 ? (
                <div className="empty" style={{ padding: '6px 0 14px' }}>
                  无
                </div>
              ) : (
                record.transcript.map((seg) => (
                  <div
                    className={`seg ${record.audioPath ? 'seekable' : ''} ${activeIdx === seg.idx ? 'active' : ''}`}
                    key={seg.idx}
                    onClick={() => record.audioPath && seekToSegment(seg.start_ms)}
                    title={record.audioPath ? '跳到录音对应位置' : undefined}
                  >
                    <span className="seg-dot" />
                    {seg.speaker && <SpeakerBadge speaker={seg.speaker} />}
                    <span className="seg-text">{seg.text}</span>
                    <span className="seg-time">{formatClock(seg.start_ms / 1000)}</span>
                  </div>
                ))
              )}

              <div className="section-label" style={{ marginTop: 16 }}>
                Copilot 记录（{record.cards.length}）
              </div>
              {record.cards.length === 0 ? (
                <div className="empty" style={{ padding: '6px 0' }}>
                  无
                </div>
              ) : (
                record.cards.map((card) => (
                  <div
                    className={`copilot-card ${card.state}`}
                    key={card.id}
                    style={{ marginBottom: 10 }}
                  >
                    <div className="card-head">
                      <span className="card-title">
                        {card.starred && (
                          <svg
                            viewBox="0 0 24 24"
                            width="12"
                            height="12"
                            style={{ marginRight: 4, verticalAlign: -1 }}
                          >
                            <path
                              d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44 6.2 20.5l1.1-6.47L2.6 9.45l6.5-.95L12 2.6z"
                              fill="#f5b301"
                            />
                          </svg>
                        )}
                        {card.title}
                      </span>
                      <span
                        className={`tag ${card.state}`}
                        title={
                          card.state === 'dismissed' && card.resolve_reason !== 'user_dismissed'
                            ? '这张卡片说的事情已经不需要了：话题已经过去，或超时未解决'
                            : undefined
                        }
                      >
                        {card.state === 'confirmed'
                          ? '✓ 已处理'
                          : card.state === 'dismissed'
                            ? card.resolve_reason === 'user_dismissed'
                              ? '已忽略'
                              : '已过期'
                            : card.type === 'need_to_ask'
                              ? '该问'
                              : '可以这么回'}
                      </span>
                    </div>
                    <div className="card-suggest">{card.suggested_text}</div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
