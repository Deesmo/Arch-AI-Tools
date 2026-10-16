/**
 * Studio results feed: the live run (progress + preview frame) followed by
 * finished runs from server history, newest first, video-first. Each card
 * plays inline and offers Save / Open graph / Reuse settings.
 */
import { useMemo, useState } from 'react';
import {
  historyOrder,
  mediaFromHistoryEntry,
  parseWorkflow,
  readTemplateValues,
  saveUrlToDevice,
  summarisePrompt,
  getTemplate,
  useGraphStore,
  useServerStore,
  useStudioStore,
  type HistoryEntry,
} from '../core';
import { Icon } from '../shared/Icon';
import { MediaView, kindLabel } from '../shared/MediaView';
import { useUiStore } from '../shared/ui';

export function ResultsFeed() {
  const history = useServerStore((s) => s.history);
  const execution = useServerStore((s) => s.execution);
  const submitted = useServerStore((s) => s.submitted);
  const info = useServerStore((s) => s.objectInfo);
  const interrupt = useServerStore((s) => s.interrupt);
  const load = useGraphStore((s) => s.load);
  const { toast, setTab, openViewer } = useUiStore();
  const { selectTemplate, setValues } = useStudioStore();
  const [limit, setLimit] = useState(8);

  const runs = useMemo(() => Object.entries(history ?? {}).sort(historyOrder), [history]);

  const openGraph = (entry: HistoryEntry, label: string) => {
    const wf = entry.prompt?.[3]?.extra_pnginfo?.workflow;
    if (!wf) return toast('No workflow stored with this run', 'error');
    try {
      load(parseWorkflow(wf, info), { name: label });
      setTab('graph');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const reuse = (promptId: string, entry: HistoryEntry) => {
    const templateId = submitted[promptId]?.templateId;
    const wfJson = entry.prompt?.[3]?.extra_pnginfo?.workflow;
    const template = templateId ? getTemplate(templateId) : undefined;
    if (!template || !wfJson) return toast('This run did not come from a Studio template', 'error');
    try {
      const wf = parseWorkflow(wfJson, info);
      setValues(template.id, readTemplateValues(template, wf));
      selectTemplate(template.id);
      toast('Settings restored from run', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const progressPct = execution.progress && execution.progress.max > 0 ? Math.round((execution.progress.value / execution.progress.max) * 100) : null;

  return (
    <div>
      {execution.status === 'running' && (
        <div className="result-card" style={{ marginBottom: 10 }}>
          <div className="media-view" style={{ aspectRatio: '16/10' }}>
            {execution.previewUrl ? <img src={execution.previewUrl} alt="preview" /> : <span className="muted small">rendering…</span>}
          </div>
          <div className="body">
            <div className="row between small">
              <span>
                Generating{execution.executingNode ? ` · node ${execution.executingNode}` : ''}
              </span>
              <span className="muted">{progressPct !== null ? `${progressPct}%` : ''}</span>
            </div>
            <div className={`progress${progressPct === null ? ' indeterminate' : ''}`} style={{ marginTop: 6 }}>
              <div style={{ width: progressPct === null ? undefined : `${progressPct}%` }} />
            </div>
            <div className="actions">
              <button className="btn sm danger" onClick={() => void interrupt()}>
                <Icon name="stop" size={14} /> Interrupt
              </button>
            </div>
          </div>
        </div>
      )}

      {runs.length === 0 && execution.status !== 'running' && <div className="empty">Your generations will appear here.</div>}

      {runs.slice(0, limit).map(([id, entry]) => {
        const media = mediaFromHistoryEntry(id, entry);
        const primary = media.find((m) => m.kind === 'video') ?? media.find((m) => m.animated) ?? media[0];
        const ok = entry.status?.status_str !== 'error';
        const fromStudio = !!submitted[id]?.templateId;
        return (
          <div className="result-card" key={id} style={{ marginBottom: 10 }}>
            {primary ? (
              <div className="media-view" onClick={() => openViewer(media, media.indexOf(primary))}>
                <MediaView item={primary} controls={primary.kind === 'video'} />
              </div>
            ) : (
              <div className="media-view" style={{ aspectRatio: '16/10' }}>
                <span className={`small ${ok ? 'muted' : 'error-text'}`}>{ok ? 'no media output' : 'failed'}</span>
              </div>
            )}
            <div className="body">
              <div className="row between" style={{ marginBottom: 4 }}>
                <span className={`badge ${ok ? 'green' : 'red'}`}>{ok ? (primary ? kindLabel(primary) : 'done') : 'error'}</span>
                <span className="muted small mono">#{entry.prompt?.[0]}{fromStudio ? ' · studio' : ''}</span>
              </div>
              <div className="prompt">{summarisePrompt(entry)}</div>
              {!ok && (
                <div className="small error-text" style={{ marginTop: 4 }}>
                  {String((entry.status?.messages ?? []).find((m) => m[0] === 'execution_error')?.[1]?.exception_message ?? 'Execution failed')}
                </div>
              )}
              <div className="actions">
                {primary && (
                  <button
                    className="btn sm"
                    onClick={async () => {
                      try {
                        const r = await saveUrlToDevice(primary.url, primary.ref.filename);
                        toast(r === 'downloaded' ? 'Downloaded' : 'Saved', 'success');
                      } catch (err) {
                        toast((err as Error).message, 'error');
                      }
                    }}
                  >
                    <Icon name="download" size={14} /> Save
                  </button>
                )}
                {fromStudio && (
                  <button className="btn sm" onClick={() => reuse(id, entry)}>
                    <Icon name="refresh" size={14} /> Reuse settings
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => openGraph(entry, `Run #${entry.prompt?.[0]}`)}>
                  <Icon name="graph" size={14} /> Graph
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {runs.length > limit && (
        <button className="btn block" onClick={() => setLimit((l) => l + 8)}>
          Show more
        </button>
      )}
    </div>
  );
}
