/**
 * Queue + history. Running/pending items can be cancelled; history entries
 * show their outputs (video first), can be re-opened as a workflow, or deleted.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  historyOrder,
  mediaFromHistoryEntry,
  parseWorkflow,
  summarisePrompt,
  useGraphStore,
  useServerStore,
  type HistoryEntry,
} from '../core';
import { Icon } from '../shared/Icon';
import { MediaView, kindLabel } from '../shared/MediaView';
import { useUiStore } from '../shared/ui';

export function QueueScreen() {
  const { queue, history, execution, refreshQueue, refreshHistory, interrupt, deleteQueueItem, clearQueue, deleteHistoryItem, clearHistory, status } = useServerStore();
  const info = useServerStore((s) => s.objectInfo);
  const load = useGraphStore((s) => s.load);
  const { toast, ask, setTab, openViewer } = useUiStore();
  const [tab, setTabLocal] = useState<'queue' | 'history'>('history');

  useEffect(() => {
    if (status === 'connected') {
      void refreshQueue();
      void refreshHistory();
    }
  }, [status, refreshQueue, refreshHistory]);

  const historyList = useMemo(() => Object.entries(history ?? {}).sort(historyOrder), [history]);
  const running = queue?.queue_running ?? [];
  const pending = queue?.queue_pending ?? [];

  const openWorkflow = (entry: HistoryEntry, name: string) => {
    const wf = entry.prompt?.[3]?.extra_pnginfo?.workflow;
    if (!wf) return toast('No workflow stored with this run', 'error');
    try {
      load(parseWorkflow(wf, info), { name });
      setTab('graph');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const progressPct = execution.progress && execution.progress.max > 0 ? Math.round((execution.progress.value / execution.progress.max) * 100) : null;

  return (
    <div className="screen">
      <div className="screen-header">
        <h1>Queue</h1>
        <div className="segmented">
          <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTabLocal('queue')}>
            Queue {running.length + pending.length ? `(${running.length + pending.length})` : ''}
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTabLocal('history')}>
            History
          </button>
        </div>
        <button className="icon-btn" onClick={() => { void refreshQueue(); void refreshHistory(); }} aria-label="Refresh">
          <Icon name="refresh" />
        </button>
      </div>

      <div className="screen-body">
        {status !== 'connected' && <div className="empty">Not connected to a server.</div>}

        {tab === 'queue' && status === 'connected' && (
          <>
            {execution.status === 'running' && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="row between">
                  <strong>Running</strong>
                  <span className="muted small">{progressPct !== null ? `${progressPct}%` : 'working…'}</span>
                </div>
                <div className={`progress${progressPct === null ? ' indeterminate' : ''}`} style={{ margin: '8px 0' }}>
                  <div style={{ width: progressPct === null ? undefined : `${progressPct}%` }} />
                </div>
                <div className="row">
                  {execution.previewUrl && <img src={execution.previewUrl} alt="preview" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }} />}
                  <div className="muted small" style={{ flex: 1 }}>
                    Node {execution.executingNode ?? '—'}
                    <br />
                    prompt {execution.promptId?.slice(0, 8)}
                  </div>
                  <button className="btn danger sm" onClick={() => void interrupt()}>
                    <Icon name="stop" size={14} /> Interrupt
                  </button>
                </div>
              </div>
            )}
            <div className="section-title">
              Pending ({pending.length})
              {pending.length > 0 && (
                <button className="btn sm" onClick={async () => { if (await ask({ title: 'Clear pending queue?', confirmLabel: 'Clear', danger: true })) await clearQueue(); }}>
                  Clear
                </button>
              )}
            </div>
            <div className="card" style={{ padding: 0 }}>
              {pending.length === 0 && running.length === 0 && <div className="empty">Queue is empty</div>}
              {[...running, ...pending].map((item) => (
                <div className="list-item" key={item[1]} style={{ cursor: 'default' }}>
                  <span className={`conn-dot ${running.includes(item) ? 'busy' : ''}`} />
                  <div className="title">
                    <div>#{item[0]} {running.includes(item) ? '(running)' : ''}</div>
                    <div className="sub mono">{item[1]}</div>
                  </div>
                  <button className="icon-btn" aria-label="Cancel" onClick={() => (running.includes(item) ? void interrupt() : void deleteQueueItem(item[1]))}>
                    <Icon name="close" size={18} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'history' && status === 'connected' && (
          <>
            <div className="section-title">
              {historyList.length} runs
              {historyList.length > 0 && (
                <button className="btn sm" onClick={async () => { if (await ask({ title: 'Clear server history?', message: 'Files stay on disk; only the run list is cleared.', confirmLabel: 'Clear', danger: true })) await clearHistory(); }}>
                  Clear
                </button>
              )}
            </div>
            {historyList.length === 0 && <div className="empty">No runs yet.</div>}
            {historyList.map(([id, entry]) => {
              const media = mediaFromHistoryEntry(id, entry);
              const ok = entry.status?.status_str !== 'error';
              const first = media.find((m) => m.kind === 'video') ?? media[0];
              return (
                <div className="card" key={id} style={{ marginBottom: 10 }}>
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <span className={`badge ${ok ? 'green' : 'red'}`}>{ok ? 'success' : 'error'}</span>
                    <span className="muted small mono">#{entry.prompt?.[0]} · {id.slice(0, 8)}</span>
                  </div>
                  {first && (
                    <div className="media-view" style={{ aspectRatio: '16/10', marginBottom: 8 }} onClick={() => openViewer(media, media.indexOf(first))}>
                      <MediaView item={first} controls={false} />
                    </div>
                  )}
                  <div className="small ellipsis" style={{ color: '#ddd' }}>{summarisePrompt(entry) || '—'}</div>
                  {!ok && (
                    <div className="small error-text" style={{ marginTop: 4 }}>
                      {String((entry.status?.messages ?? []).find((m) => m[0] === 'execution_error')?.[1]?.exception_message ?? 'Execution failed')}
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                    {media.length > 0 && (
                      <button className="btn sm" onClick={() => openViewer(media, 0)}>
                        <Icon name="gallery" size={14} /> {media.length} {media.length === 1 ? kindLabel(media[0]) : 'outputs'}
                      </button>
                    )}
                    <button className="btn sm" onClick={() => openWorkflow(entry, `Run #${entry.prompt?.[0]}`)}>
                      <Icon name="graph" size={14} /> Open graph
                    </button>
                    <button className="btn sm ghost" onClick={() => void deleteHistoryItem(id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
