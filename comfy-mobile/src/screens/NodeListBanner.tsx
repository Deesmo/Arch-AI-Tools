/**
 * Thin strip under the status bar while the server's node list
 * (`/object_info`) downloads, parses, or has failed — the app is already
 * connected and usable; Studio templates and the Graph node search light up
 * when this finishes. Shows bytes / total / rate from the streamed download,
 * flags a WebSocket that failed to open (HTTP-only mode), and tapping it
 * opens the same diagnostics + "Copy details" as the connect screen.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  buildConnectionReport,
  classifyNodeList,
  copyText,
  describeNodeListLoad,
  formatBytes,
  formatConnectionReport,
  problemFix,
  problemTitle,
  serverLabel,
  useServerStore,
  useSettingsStore,
} from '../core';
import { Icon } from '../shared/Icon';
import { Sheet } from '../shared/Sheet';

export function NodeListBanner() {
  const status = useServerStore((s) => s.status);
  const nodeList = useServerStore((s) => s.nodeList);
  const wsBlocked = useServerStore((s) => s.wsBlocked);
  const wsState = useServerStore((s) => s.wsState);
  const loadNodeList = useServerStore((s) => s.loadNodeList);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const bannerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [now, setNow] = useState(Date.now());

  const active = status === 'connected' && (nodeList.phase === 'loading' || nodeList.phase === 'parsing');
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const show = status === 'connected' && (active || nodeList.phase === 'error' || (wsBlocked && wsState !== 'open'));
  useLayoutEffect(() => {
    const el = bannerRef.current;
    if (!show || !el) {
      document.documentElement.style.removeProperty('--nodelist-banner-h');
      return;
    }
    const apply = () => {
      document.documentElement.style.setProperty('--nodelist-banner-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    };
    apply();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      document.documentElement.style.removeProperty('--nodelist-banner-h');
    };
  }, [show, nodeList.phase, nodeList.received, wsBlocked, wsState]);

  if (!show) return null;
  const failed = nodeList.phase === 'error';
  const socketDown = wsBlocked && wsState !== 'open';

  const label = serverLabel(serverUrl);
  const text = active || failed ? describeNodeListLoad(nodeList, label, now) : { title: 'Live updates unavailable (WebSocket blocked)', detail: 'polling the queue instead · tap for details' };
  const pct = nodeList.total && nodeList.total > 0 ? Math.min(100, Math.round((nodeList.received / nodeList.total) * 100)) : null;
  const problem = classifyNodeList(serverUrl, nodeList, now);
  const tone = failed ? 'error' : socketDown && !active ? 'warn' : 'info';

  const copyDetails = async () => {
    const ok = await copyText(formatConnectionReport(buildConnectionReport(problem)));
    setCopied(ok ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <>
      <button ref={bannerRef} className={`nodelist-banner ${tone}`} onClick={() => setOpen(true)} data-testid="nodelist-banner" aria-live="polite">
        <span className="nodelist-icon">
          {active ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="warning" size={14} />}
        </span>
        <span className="nodelist-text">
          <span>{text.title}</span>
          {text.detail && <span className="nodelist-detail">{text.detail}</span>}
        </span>
        {active && pct !== null && <span className="nodelist-pct mono">{pct}%</span>}
        {failed && (
          <span
            className="nodelist-retry"
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              void loadNodeList();
            }}
          >
            Retry
          </span>
        )}
        {active && (
          <span className="nodelist-bar" aria-hidden>
            <span className={pct === null ? 'indeterminate' : ''} style={pct === null ? undefined : { width: `${pct}%` }} />
          </span>
        )}
      </button>

      {open && (
        <Sheet title="Connection details" onClose={() => setOpen(false)}>
          <div className="card" style={{ marginBottom: 10 }}>
            <strong>{problem ? problemTitle(problem) : failed ? 'Node list failed' : socketDown ? 'HTTP works, but the WebSocket is blocked' : 'Node list loading'}</strong>
            <div className="small muted" style={{ marginTop: 4 }}>
              {problem ? problemFix(problem) : failed ? (nodeList.error ?? '') : socketDown ? 'The REST API answers but /ws never opened; the app polls the queue every 5 s instead. Live progress and previews need the socket (check any proxy in front of ComfyUI).' : `${text.title} ${text.detail}`}
            </div>
          </div>
          <div className="small mono muted" style={{ lineHeight: 1.6 }}>
            {nodeList.url ?? `${serverUrl}/object_info`}
            <br />
            {formatBytes(nodeList.received)}
            {nodeList.total !== null ? ` of ${formatBytes(nodeList.total)}` : ''}
            {nodeList.startedAt ? ` · ${(((nodeList.finishedAt ?? now) - nodeList.startedAt) / 1000).toFixed(0)}s` : ''}
            {nodeList.fromCache ? ' · using cached node list meanwhile' : ''}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            {failed && (
              <button className="btn primary" style={{ flex: 1 }} onClick={() => { void loadNodeList(); setOpen(false); }}>
                <Icon name="refresh" size={16} /> Retry download
              </button>
            )}
            <button className="btn" style={{ flex: 1 }} onClick={() => void copyDetails()}>
              <Icon name="copy" size={16} /> {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy details'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
