/** Server URL, connection diagnostics, editor preferences, local data. */
import { useState } from 'react';
import {
  DEFAULT_SERVER_URL,
  diagnoseConnection,
  normalizeServerUrl,
  problemFix,
  problemTitle,
  useServerStore,
  useSettingsStore,
  type ConnectionProblem,
  type LinkStyle,
} from '../core';
import { Icon } from '../shared/Icon';
import { useUiStore } from '../shared/ui';

export function SettingsScreen() {
  const settings = useSettingsStore();
  const { status, systemStats, objectInfo, lastError, connect, wsState } = useServerStore();
  const toast = useUiStore((s) => s.toast);
  const ask = useUiStore((s) => s.ask);
  const [url, setUrl] = useState(settings.serverUrl);
  const [diag, setDiag] = useState<ConnectionProblem | null>(null);
  const [testing, setTesting] = useState(false);

  const applyUrl = () => {
    const next = normalizeServerUrl(url);
    setUrl(next);
    if (next !== settings.serverUrl) settings.set({ serverUrl: next });
    else void connect();
  };

  const test = async () => {
    setTesting(true);
    applyUrl();
    const p = await diagnoseConnection();
    setDiag(p);
    setTesting(false);
  };

  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="list-item" style={{ cursor: 'default' }}>
      <div className="title">
        <div>{label}</div>
        {hint && <div className="sub">{hint}</div>}
      </div>
      {children}
    </div>
  );

  const Toggle = ({ k }: { k: 'snapToGrid' | 'showGrid' | 'showNodeIds' | 'confirmDelete' }) => (
    <button className={`switch${settings[k] ? ' on' : ''}`} onClick={() => settings.set({ [k]: !settings[k] })} aria-pressed={settings[k]} />
  );

  return (
    <div className="screen">
      <div className="screen-header">
        <h1>Settings</h1>
      </div>
      <div className="screen-body">
        <div className="section-title">ComfyUI server</div>
        <div className="card">
          <div className="field">
            <label>Server URL</label>
            <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={applyUrl} inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder={DEFAULT_SERVER_URL} />
            <div className="field-hint">Skytech over Tailscale by default. Start ComfyUI with <span className="kbd">--listen 0.0.0.0 --enable-cors-header</span>.</div>
          </div>
          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} onClick={test} disabled={testing}>
              <Icon name="wifi" size={16} /> {testing ? 'Testing…' : 'Test & connect'}
            </button>
            <button className="btn" onClick={() => { setUrl(DEFAULT_SERVER_URL); settings.set({ serverUrl: DEFAULT_SERVER_URL }); }}>
              Reset
            </button>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className={`conn-dot ${status === 'connected' ? 'ok' : status === 'connecting' ? 'busy' : 'bad'}`} />
            <span className="small">
              {status === 'connected' ? `Connected · socket ${wsState}` : status === 'connecting' ? 'Connecting…' : lastError ?? 'Not connected'}
            </span>
          </div>
          {diag && diag.kind !== 'ok' && (
            <div className="card" style={{ marginTop: 10, borderColor: 'var(--warning)' }}>
              <strong style={{ color: 'var(--warning)' }}>{problemTitle(diag)}</strong>
              <div className="small" style={{ marginTop: 4 }}>{problemFix(diag)}</div>
            </div>
          )}
          {systemStats && (
            <div className="small muted mono" style={{ marginTop: 10, lineHeight: 1.6 }}>
              ComfyUI {systemStats.system.comfyui_version ?? '?'} · {systemStats.system.os} · torch {systemStats.system.pytorch_version ?? '?'}
              <br />
              {systemStats.devices.map((d) => `${d.name} · ${(d.vram_total / 1e9).toFixed(0)} GB VRAM (${(d.vram_free / 1e9).toFixed(1)} free)`).join(', ')}
              <br />
              {objectInfo ? `${Object.keys(objectInfo).length} node types` : ''}
            </div>
          )}
        </div>

        <div className="section-title">Launch</div>
        <div className="card" style={{ padding: 0 }}>
          <Row label="Default mode" hint="Screen shown when the app opens">
            <div className="segmented">
              <button className={settings.defaultMode === 'studio' ? 'active' : ''} onClick={() => settings.set({ defaultMode: 'studio' })}>Studio</button>
              <button className={settings.defaultMode === 'graph' ? 'active' : ''} onClick={() => settings.set({ defaultMode: 'graph' })}>Graph</button>
            </div>
          </Row>
          <Row label="History items" hint="How many runs the gallery loads">
            <div className="segmented">
              {[32, 64, 128, 256].map((n) => (
                <button key={n} className={settings.historyLimit === n ? 'active' : ''} onClick={() => settings.set({ historyLimit: n })}>{n}</button>
              ))}
            </div>
          </Row>
        </div>

        <div className="section-title">Graph editor</div>
        <div className="card" style={{ padding: 0 }}>
          <Row label="Snap to grid"><Toggle k="snapToGrid" /></Row>
          <Row label="Show grid"><Toggle k="showGrid" /></Row>
          <Row label="Show node IDs"><Toggle k="showNodeIds" /></Row>
          <Row label="Confirm before delete"><Toggle k="confirmDelete" /></Row>
          <Row label="Link style">
            <div className="segmented">
              {(['spline', 'linear', 'straight'] as LinkStyle[]).map((s) => (
                <button key={s} className={settings.linkStyle === s ? 'active' : ''} onClick={() => settings.set({ linkStyle: s })}>{s}</button>
              ))}
            </div>
          </Row>
        </div>

        <div className="section-title">Privacy</div>
        <div className="card small">
          This app talks only to the ComfyUI server configured above. No analytics, update checks, fonts, or other network calls. Workflows, settings and recipes are stored on this device.
        </div>

        <div className="section-title">Local data</div>
        <div className="card" style={{ padding: 0 }}>
          <div
            className="list-item"
            onClick={async () => {
              if (await ask({ title: 'Clear all local data?', message: 'Saved workflows, recipes, settings and the current graph on this device will be erased. Nothing on the server is touched.', confirmLabel: 'Erase', danger: true })) {
                Object.keys(localStorage).filter((k) => k.startsWith('comfy-mobile.')).forEach((k) => localStorage.removeItem(k));
                toast('Local data cleared — restart the app');
              }
            }}
          >
            <Icon name="trash" size={20} />
            <div className="title error-text">Clear local data</div>
          </div>
        </div>
        <p className="muted small" style={{ textAlign: 'center', marginTop: 20 }}>
          Comfy Mobile · ComfyUI client · Studio + Graph
        </p>
      </div>
    </div>
  );
}
