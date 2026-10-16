/**
 * Where the bundle comes from: tailnet URL (default = Mac mini :8152) or a
 * file picked on the device. Also shows what is loaded and lets Brad forget it.
 */
import { useRef, useState } from 'react';
import { DEFAULT_CONTENT_SOURCE_URL, useContentStore } from '../../core';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import { useUiStore } from '../../shared/ui';

export function SourceSheet({ onClose }: { onClose: () => void }) {
  const { sourceUrl, setSourceUrl, refresh, importFile, clear, status, error, bundle, loadedAt, origin } = useContentStore();
  const toast = useUiStore((s) => s.toast);
  const ask = useUiStore((s) => s.ask);
  const [url, setUrl] = useState(sourceUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    setSourceUrl(url);
    setUrl(useContentStore.getState().sourceUrl);
  };

  const fetchNow = async () => {
    apply();
    const ok = await refresh();
    if (ok) {
      const c = useContentStore.getState().bundle?.counts ?? {};
      toast(`Loaded ${c.copyCards ?? 0} copy cards · ${c.recipes ?? 0} recipes · ${c.loras ?? 0} LoRA cards · ${c.workflows ?? 0} workflows`, 'success');
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const ok = await importFile(f);
    if (ok) toast(`Imported ${f.name}`, 'success');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Sheet title="Content source" onClose={onClose} full>
      <div className="section-title">From the Mac (tailnet)</div>
      <div className="card">
        <div className="field">
          <label>Bundle URL</label>
          <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={apply} inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder={DEFAULT_CONTENT_SOURCE_URL} />
          <div className="field-hint">Served by <span className="kbd">python3 tools/export_video_studio.py --serve</span> on the Mac mini. Tailscale only — nothing leaves the tailnet.</div>
        </div>
        <div className="row">
          <button className="btn primary" style={{ flex: 1 }} onClick={() => void fetchNow()} disabled={status === 'loading'}>
            <Icon name="refresh" size={16} /> {status === 'loading' ? 'Fetching…' : 'Fetch now'}
          </button>
          <button className="btn" onClick={() => { setUrl(DEFAULT_CONTENT_SOURCE_URL); setSourceUrl(DEFAULT_CONTENT_SOURCE_URL); }}>Reset</button>
        </div>
        {error && (
          <div className="card" style={{ marginTop: 10, borderColor: 'var(--warning)' }}>
            <div className="small" style={{ color: 'var(--warning)' }}>{error}</div>
          </div>
        )}
      </div>

      <div className="section-title">From a file</div>
      <div className="card">
        <button className="btn block" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={16} /> Import bundle.json…
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        <div className="field-hint" style={{ marginTop: 8 }}>AirDrop or copy <span className="kbd">~/comfy-mobile-content/bundle.json</span> to the phone and pick it here. Works offline.</div>
      </div>

      <div className="section-title">Loaded now</div>
      <div className="card small">
        {!bundle && <span className="muted">Nothing loaded yet.</span>}
        {bundle && (
          <div className="ms-kv mono">
            <div><span className="muted">from</span> {origin === 'file' ? 'file' : 'URL'} · {loadedAt ? new Date(loadedAt).toLocaleString() : ''}</div>
            <div><span className="muted">exported</span> {bundle.exportedAt ? new Date(bundle.exportedAt).toLocaleString() : '?'}{bundle.exporter.host ? ` on ${bundle.exporter.host}` : ''}</div>
            <div><span className="muted">root</span> {bundle.exporter.root || '?'}</div>
            <div><span className="muted">counts</span> {Object.entries(bundle.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
          </div>
        )}
      </div>
      {bundle && (
        <div className="card" style={{ padding: 0, marginTop: 10 }}>
          <div
            className="list-item"
            onClick={async () => {
              if (await ask({ title: 'Forget the loaded bundle?', message: 'Removes the cached copy from this device. Your LoRA ratings already copied into the picker stay. Fetch or import again any time.', confirmLabel: 'Forget', danger: true })) {
                await clear();
                toast('Bundle removed from this device');
              }
            }}
          >
            <Icon name="trash" size={20} />
            <div className="title error-text">Forget cached bundle</div>
          </div>
        </div>
      )}

      <div className="section-title">On the Mac mini</div>
      <div className="card small ms-kv mono">
        <div>python3 comfy-mobile/tools/export_video_studio.py</div>
        <div>python3 comfy-mobile/tools/export_video_studio.py --serve</div>
      </div>
      <p className="muted small">The first command reads ~/archon-staging/video-studio and writes only ~/comfy-mobile-content/bundle.json. The second serves that folder on port 8152 for this app.</p>
    </Sheet>
  );
}
