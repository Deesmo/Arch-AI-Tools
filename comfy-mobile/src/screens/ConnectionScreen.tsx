/**
 * Shown on launch until the server answers, and whenever the connection fails.
 * Distinguishes CORS vs unreachable vs wrong URL and shows the matching fix.
 */
import { useEffect, useState } from 'react';
import { diagnoseConnection, normalizeServerUrl, problemFix, problemTitle, useServerStore, useSettingsStore, type ConnectionProblem } from '../core';
import { Icon } from '../shared/Icon';

export function ConnectionScreen({ onContinueOffline }: { onContinueOffline: () => void }) {
  const status = useServerStore((s) => s.status);
  const connect = useServerStore((s) => s.connect);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const setSettings = useSettingsStore((s) => s.set);
  const [url, setUrl] = useState(serverUrl);
  const [problem, setProblem] = useState<ConnectionProblem | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  useEffect(() => {
    setUrl(serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    if (status === 'error') {
      setDiagnosing(true);
      void diagnoseConnection().then((p) => {
        setProblem(p);
        setDiagnosing(false);
      });
    } else {
      setProblem(null);
    }
  }, [status]);

  const retry = () => {
    const next = normalizeServerUrl(url);
    if (next !== serverUrl) setSettings({ serverUrl: next });
    else void connect();
  };

  const busy = status === 'connecting' || diagnosing;

  return (
    <div className="conn-screen">
      <div className="logo">
        <Icon name="film" />
      </div>
      <h1>{busy ? 'Connecting to ComfyUI…' : problem ? problemTitle(problem) : 'Connect to ComfyUI'}</h1>
      <p>
        {busy
          ? serverUrl
          : problem
            ? problemFix(problem)
            : 'Enter the address of the machine running ComfyUI (Skytech over Tailscale by default).'}
      </p>
      {status === 'error' && problem?.kind === 'cors' && (
        <div className="card mono small" style={{ textAlign: 'left', marginBottom: 14, maxWidth: 420, width: '100%' }}>
          python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header
        </div>
      )}
      <div className="actions">
        <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" onKeyDown={(e) => e.key === 'Enter' && retry()} />
        <button className="btn primary block" onClick={retry} disabled={status === 'connecting'}>
          <Icon name="refresh" size={16} /> {status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
        <button className="btn block" onClick={onContinueOffline}>
          Continue offline (edit graphs only)
        </button>
      </div>
      {busy && (
        <div className="progress indeterminate" style={{ width: 200, marginTop: 20 }}>
          <div />
        </div>
      )}
    </div>
  );
}
