/**
 * Shown on launch until the server answers, and whenever the connection fails.
 *
 * While connecting it names the step in flight (`/system_stats`, then `/ws`)
 * with a live elapsed timer, so "connecting…" is never a black box. On failure
 * it runs the diagnosis (CORS / unreachable / mixed content / WS blocked /
 * wrong URL), shows the exact request that failed with its status, and offers
 * "Copy details" — a plain-text report that can be pasted into a chat.
 *
 * "Connected" does not depend on `/object_info`; that loads in the background
 * and is reported by `NodeListBanner`.
 */
import { useEffect, useState } from 'react';
import {
  STATS_TIMEOUT_MS,
  WS_GRACE_MS,
  buildConnectionReport,
  copyText,
  diagnoseConnection,
  formatConnectionReport,
  normalizeServerUrl,
  problemFix,
  problemTitle,
  useServerStore,
  useSettingsStore,
  type ConnectionProblem,
} from '../core';
import { Icon } from '../shared/Icon';

/** Re-renders every 500 ms while `active` so elapsed-time copy stays live. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function ConnectionScreen({ onContinueOffline }: { onContinueOffline: () => void }) {
  const status = useServerStore((s) => s.status);
  const phase = useServerStore((s) => s.connectPhase);
  const startedAt = useServerStore((s) => s.connectStartedAt);
  const failure = useServerStore((s) => s.lastFailure);
  const lastError = useServerStore((s) => s.lastError);
  const connect = useServerStore((s) => s.connect);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const setSettings = useSettingsStore((s) => s.set);
  const [url, setUrl] = useState(serverUrl);
  const [problem, setProblem] = useState<ConnectionProblem | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const now = useTicker(status === 'connecting');

  useEffect(() => {
    setUrl(serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    if (status === 'error') {
      setDiagnosing(true);
      let cancelled = false;
      void diagnoseConnection({ timeoutMs: 6000 }).then((p) => {
        if (cancelled) return;
        setProblem(p);
        setDiagnosing(false);
      });
      return () => {
        cancelled = true;
      };
    }
    setProblem(null);
    setReport(null);
    setCopied(null);
  }, [status]);

  const retry = () => {
    const next = normalizeServerUrl(url);
    if (next !== serverUrl) setSettings({ serverUrl: next });
    else void connect();
  };

  const copyDetails = async () => {
    const text = formatConnectionReport(buildConnectionReport(problem));
    setReport(text);
    const ok = await copyText(text);
    setCopied(ok ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 2500);
  };

  const elapsed = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
  const busy = status === 'connecting' || diagnosing;

  const phaseLine = (() => {
    if (status !== 'connecting') return null;
    if (phase === 'ws') return `Opening live connection (/ws)… ${elapsed.toFixed(0)}s`;
    return `Checking server (/system_stats)… ${elapsed.toFixed(0)}s`;
  })();
  const slowHint =
    status === 'connecting' && elapsed > 5
      ? phase === 'ws'
        ? `No socket yet. If it does not open within ${WS_GRACE_MS / 1000}s the app continues over HTTP only.`
        : `Still waiting. The server is slow to answer or the route is relayed; gives up at ${STATS_TIMEOUT_MS / 1000}s with a diagnosis.`
      : null;

  const title = status === 'connecting' ? 'Connecting to ComfyUI…' : diagnosing ? 'Checking what went wrong…' : problem ? problemTitle(problem) : status === 'error' ? 'Could not connect' : 'Connect to ComfyUI';

  return (
    <div className="conn-screen">
      <div className="logo">
        <Icon name="film" />
      </div>
      <h1>{title}</h1>
      <p>
        {status === 'connecting' || diagnosing
          ? serverUrl
          : problem
            ? problemFix(problem)
            : status === 'error'
              ? (lastError ?? 'Unknown error')
              : 'Enter the address of the machine running ComfyUI (Skytech over Tailscale by default).'}
      </p>

      {phaseLine && (
        <div className="conn-phase" aria-live="polite">
          <div className="small mono">{phaseLine}</div>
          {slowHint && <div className="small muted" style={{ marginTop: 4 }}>{slowHint}</div>}
        </div>
      )}

      {status === 'error' && problem?.kind === 'cors' && (
        <div className="card mono small" style={{ textAlign: 'left', marginBottom: 14, maxWidth: 420, width: '100%' }}>
          python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header
        </div>
      )}

      {status === 'error' && !diagnosing && (failure || (problem && 'url' in problem)) && (
        <div className="card conn-failure small mono" data-testid="conn-failure">
          {failure && (
            <div>
              <span className="muted">failed: </span>
              GET {failure.url}
              {failure.status !== null ? ` → HTTP ${failure.status}` : ''} · {failure.kind}
              {failure.kind === 'timeout' ? ` (${STATS_TIMEOUT_MS / 1000}s)` : ''}
            </div>
          )}
          {problem && 'url' in problem && (!failure || problem.url !== failure.url) && (
            <div>
              <span className="muted">tested: </span>
              {problem.url}
              {'status' in problem ? ` → HTTP ${problem.status}` : ''}
              {'detail' in problem ? ` · ${problem.detail}` : ''}
            </div>
          )}
        </div>
      )}

      <div className="actions">
        <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" onKeyDown={(e) => e.key === 'Enter' && retry()} aria-label="Server URL" />
        <button className="btn primary block" onClick={retry} disabled={status === 'connecting'}>
          <Icon name="refresh" size={16} /> {status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
        {status === 'error' && (
          <button className="btn block" onClick={() => void copyDetails()} disabled={diagnosing} data-testid="copy-details">
            <Icon name="copy" size={16} /> {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed — select the text below' : 'Copy details'}
          </button>
        )}
        <button className="btn block" onClick={onContinueOffline}>
          Continue offline (edit graphs only)
        </button>
      </div>

      {report && (
        <textarea className="input mono conn-report" readOnly value={report} rows={10} onFocus={(e) => e.currentTarget.select()} aria-label="Connection report" />
      )}

      {busy && (
        <div className="progress indeterminate" style={{ width: 200, marginTop: 20 }}>
          <div />
        </div>
      )}
    </div>
  );
}
