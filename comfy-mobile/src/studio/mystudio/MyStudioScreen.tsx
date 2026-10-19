/**
 * My Studio — pictures that shipped with this page.
 *
 * Loads `/studio-thumbs/index.json` and the files it names. No other host,
 * no PIN, no cookie.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  MISSING_PICTURES,
  cardImage,
  copyMainClip,
  loadStudioThumbs,
  primeStudioGallery,
  studioSearchHit,
  studioThumbUrl,
  type StudioThumbCatalog,
  type StudioThumbCopy,
  type StudioThumbWorkflow,
} from '../../core';
import { Icon } from '../../shared/Icon';
import { RunSheet, type RunPreview } from './RunSheet';
import { CopyCard, LoraCard, WorkflowCard } from './ThumbCards';
import './mystudio.css';

type Section = 'copies' | 'loras' | 'workflows';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'copies', label: 'Copy cards' },
  { id: 'loras', label: 'LoRAs' },
  { id: 'workflows', label: 'Workflows' },
];

function useStudioThumbs() {
  const [status, setStatus] = useState<'loading' | 'missing' | 'ready'>('loading');
  const [catalog, setCatalog] = useState<StudioThumbCatalog | null>(null);
  useEffect(() => {
    void primeStudioGallery();
  }, []);
  useEffect(() => {
    let live = true;
    void loadStudioThumbs().then((result) => {
      if (!live) return;
      if (!result.ok) setStatus('missing');
      else {
        setCatalog(result.catalog);
        setStatus('ready');
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return { status, catalog };
}

function copyPreview(card: StudioThumbCopy): RunPreview {
  const clip = copyMainClip(card);
  if (clip) return { kind: 'video', src: clip.src, poster: clip.poster };
  const still = studioThumbUrl(card.poster);
  return still ? { kind: 'image', src: still } : null;
}

function workflowPreview(card: StudioThumbWorkflow): RunPreview {
  const src = cardImage(card.thumb, card.examples);
  return src ? { kind: 'image', src } : null;
}

export function MyStudioScreen() {
  const { status, catalog } = useStudioThumbs();
  const [section, setSection] = useState<Section>('copies');
  const [q, setQ] = useState('');
  const [run, setRun] = useState<{ card: StudioThumbCopy | StudioThumbWorkflow; preview: RunPreview } | null>(null);
  const [blurbs, setBlurbs] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    void fetch('/studio-thumbs/workflow-blurbs.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        if (live && data && typeof data === 'object') setBlurbs(data as Record<string, string>);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const counts = {
    copies: catalog?.copies.length ?? 0,
    loras: catalog?.loras.length ?? 0,
    workflows: catalog?.workflows.length ?? 0,
  };

  const copies = useMemo(
    () => (catalog?.copies ?? []).filter((c) => studioSearchHit(q, [c.name, c.prompt, c.model, c.author, c.duration, c.civitaiId])),
    [catalog, q],
  );
  const loras = useMemo(
    () => (catalog?.loras ?? []).filter((c) => studioSearchHit(q, [c.name, c.file, c.trigger, c.model, c.author, c.civitaiId])),
    [catalog, q],
  );
  const workflows = useMemo(
    () => (catalog?.workflows ?? []).filter((c) => studioSearchHit(q, [c.name, c.prompt, c.model, c.author, c.civitaiId, c.workflowFile ? blurbs[c.workflowFile] : ''])),
    [catalog, q, blurbs],
  );

  const label = SECTIONS.find((s) => s.id === section)?.label.toLowerCase() ?? '';

  return (
    <div className="screen">
      <div className="screen-header">
        <h1>My Studio</h1>
      </div>
      <div className="screen-body">
        {status === 'loading' && <p className="small muted">Loading…</p>}
        {status === 'missing' && <p className="ms-missing">{MISSING_PICTURES}</p>}
        {status === 'ready' && catalog && (
          <>
            <div className="ms-sections">
              {SECTIONS.map((s) => (
                <button key={s.id} className={`chip${section === s.id ? ' active' : ''}`} onClick={() => setSection(s.id)}>
                  {s.label} <span className="muted">{counts[s.id].toLocaleString()}</span>
                </button>
              ))}
            </div>
            <div className="ms-search">
              <Icon name="search" size={16} />
              <input className="input" placeholder={`Search ${label}…`} value={q} onChange={(e) => setQ(e.target.value)} />
              {q && (
                <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
            {section === 'copies' && (
              copies.length ? (
                <div className="ms-copy-list">
                  {copies.map((c, i) => (
                    <CopyCard key={`${c.name}-${i}`} card={c} onOpen={() => setRun({ card: c, preview: copyPreview(c) })} />
                  ))}
                </div>
              ) : (
                <div className="empty">{q ? `No copy cards match “${q}”.` : 'No copy cards in this build.'}</div>
              )
            )}
            {section === 'loras' && (
              loras.length ? (
                <div className="card" style={{ padding: 0 }}>
                  {loras.map((c, i) => (
                    <LoraCard key={`${c.file || c.name}-${i}`} card={c} />
                  ))}
                </div>
              ) : (
                <div className="empty">{q ? `No LoRAs match “${q}”.` : 'No LoRAs in this build.'}</div>
              )
            )}
            {section === 'workflows' && (
              workflows.length ? (
                <div className="card" style={{ padding: 0 }}>
                  {workflows.map((c, i) => (
                    <WorkflowCard key={`${c.name}-${i}`} card={c} blurb={c.workflowFile ? blurbs[c.workflowFile] : undefined} onOpen={() => setRun({ card: c, preview: workflowPreview(c) })} />
                  ))}
                </div>
              ) : (
                <div className="empty">{q ? `No workflows match “${q}”.` : 'No workflows in this build.'}</div>
              )
            )}
          </>
        )}
      </div>
      {run && <RunSheet card={run.card} preview={run.preview} loras={catalog?.loras ?? []} onClose={() => setRun(null)} />}
    </div>
  );
}
