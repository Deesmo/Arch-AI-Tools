/**
 * "My Studio" — Brad's own Video Studio content on the phone.
 *
 *   header      refresh · Source (URL / file / forget)
 *   status      what is loaded, from where, how old — or an empty state
 *   sections    Copy cards · Recipes · LoRA Lab · Workflows · Presets · Videos · More
 *   search      filters the open section
 *
 * Data: `useContentStore` (bundle cached on-device). Actions: `useMyStudio`.
 */
import { useEffect, useMemo, useState } from 'react';
import { bundleIsEmpty, useContentStore } from '../../core';
import { Icon } from '../../shared/Icon';
import { SourceSheet } from './SourceSheet';
import { VideosSection } from './Media';
import { CopyCardsSection, LoraLabSection, MoreSection, PresetsSection, RecipesSection, WorkflowsSection } from './sections';
import { useMyStudio } from './useMyStudio';
import './mystudio.css';

type Section = 'copy' | 'recipes' | 'loras' | 'workflows' | 'presets' | 'videos' | 'more';

const SECTIONS: { id: Section; label: string; count: (c: Record<string, number>) => number }[] = [
  { id: 'copy', label: 'Copy cards', count: (c) => c.copyCards ?? 0 },
  { id: 'recipes', label: 'Recipes', count: (c) => c.recipes ?? 0 },
  { id: 'loras', label: 'LoRA Lab', count: (c) => c.loras ?? 0 },
  { id: 'workflows', label: 'Workflows', count: (c) => c.workflows ?? 0 },
  { id: 'presets', label: 'Presets', count: (c) => c.presets ?? 0 },
  { id: 'videos', label: 'Videos', count: (c) => c.videos ?? 0 },
  { id: 'more', label: 'More', count: (c) => (c.characters ?? 0) + (c.assets ?? 0) + (c.raw ?? 0) },
];

function ago(ms: number | null): string {
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function MyStudioScreen() {
  const bundle = useContentStore((s) => s.bundle);
  const status = useContentStore((s) => s.status);
  const error = useContentStore((s) => s.error);
  const loadedAt = useContentStore((s) => s.loadedAt);
  const origin = useContentStore((s) => s.origin);
  const hydrated = useContentStore((s) => s.hydrated);
  const refresh = useContentStore((s) => s.refresh);
  const hydrate = useContentStore((s) => s.hydrate);
  const actions = useMyStudio();
  const [section, setSection] = useState<Section>('copy');
  const [q, setQ] = useState('');
  const [source, setSource] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // First visit with nothing cached: try the Mac once, quietly.
  useEffect(() => {
    if (hydrated && !bundle && status === 'idle') void refresh();
  }, [hydrated, bundle, status, refresh]);

  const counts = bundle?.counts ?? {};
  const empty = bundleIsEmpty(bundle);
  const visible = useMemo(() => SECTIONS.filter((s) => (s.id === 'more' || s.id === 'videos' ? s.count(counts) > 0 : true)), [counts]);
  const previews = (counts.visuals ?? 0) + (counts.videos ?? 0);

  return (
    <div className="screen">
      <div className="screen-header">
        <h1>My Studio</h1>
        <button className="icon-btn" aria-label="Refresh from Mac" title="Refresh from Mac" disabled={status === 'loading'} onClick={() => void refresh()}>
          <Icon name="refresh" className={status === 'loading' ? 'ms-spin' : undefined} />
        </button>
        <button className="btn sm" onClick={() => setSource(true)}>
          <Icon name="settings" size={14} /> Source
        </button>
      </div>

      <div className="screen-body">
        {empty ? (
          <div className="card ms-empty">
            <h3>Your Video Studio content, on the phone</h3>
            <p className="small">
              Copy cards, author recipes with trigger words, your rated LoRAs, saved workflows and presets — exported from the Mac mini and kept on the tailnet.
            </p>
            {status === 'loading' && <p className="small muted">Fetching from the Mac…</p>}
            {error && <p className="small" style={{ color: 'var(--warning)' }}>{error}</p>}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" style={{ flex: 1 }} disabled={status === 'loading'} onClick={() => void refresh()}>
                <Icon name="refresh" size={16} /> Fetch from Mac
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => setSource(true)}>
                <Icon name="upload" size={16} /> Import file
              </button>
            </div>
            <div className="ms-steps small muted">
              <div>On the Mac mini, in the repo:</div>
              <div className="mono">python3 comfy-mobile/tools/export_video_studio.py</div>
              <div className="mono">python3 comfy-mobile/tools/export_video_studio.py --serve</div>
            </div>
          </div>
        ) : (
          <>
            <div className="ms-status small" onClick={() => setSource(true)}>
              <span className={`conn-dot ${error ? 'busy' : 'ok'}`} />
              <span className="ellipsis">
                {origin === 'file' ? 'From file' : 'From Mac'} · {ago(loadedAt)}
                {bundle?.exportedAt ? ` · exported ${new Date(bundle.exportedAt).toLocaleDateString()}` : ''}
                {previews ? ` · ${previews} preview${previews === 1 ? '' : 's'}` : ''}
                {error ? ` · refresh failed` : ''}
              </span>
              <Icon name="chevron" size={14} />
            </div>

            <div className="ms-sections">
              {visible.map((s) => (
                <button key={s.id} className={`chip${section === s.id ? ' active' : ''}`} onClick={() => setSection(s.id)}>
                  {s.label} <span className="muted">{s.count(counts)}</span>
                </button>
              ))}
            </div>

            <div className="ms-search">
              <Icon name="search" size={16} />
              <input className="input" placeholder={`Search ${visible.find((s) => s.id === section)?.label.toLowerCase() ?? ''}…`} value={q} onChange={(e) => setQ(e.target.value)} />
              {q && (
                <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>

            {bundle && section === 'copy' && <CopyCardsSection bundle={bundle} q={q} actions={actions} />}
            {bundle && section === 'recipes' && <RecipesSection bundle={bundle} q={q} actions={actions} />}
            {bundle && section === 'loras' && <LoraLabSection bundle={bundle} q={q} actions={actions} />}
            {bundle && section === 'workflows' && <WorkflowsSection bundle={bundle} q={q} actions={actions} />}
            {bundle && section === 'presets' && <PresetsSection bundle={bundle} q={q} actions={actions} />}
            {bundle && section === 'videos' && <VideosSection bundle={bundle} q={q} />}
            {bundle && section === 'more' && <MoreSection bundle={bundle} q={q} actions={actions} />}
          </>
        )}
      </div>

      {source && <SourceSheet onClose={() => setSource(false)} />}
    </div>
  );
}
