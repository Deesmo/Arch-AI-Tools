/**
 * The five My Studio lists. Each takes the search string + shared actions.
 * Labels use Brad's words: Copy cards, Recipes, LoRA Lab, Workflows, Presets.
 */
import { useMemo, useState } from 'react';
import { prettyName, summariseSettings, useContentStore, type BundledWorkflow, type ContentBundle, type CopyCard, type LoraIndexEntry, type StudioRecipe } from '../../core';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import type { MyStudioActions } from './useMyStudio';

const has = (hay: string | undefined | null, needle: string) => !!hay && hay.toLowerCase().includes(needle);
const anyHas = (fields: (string | undefined | null)[], needle: string) => !needle || fields.some((f) => has(f, needle));

export function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="ms-stars muted">unrated</span>;
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="ms-stars" aria-label={`${rating} of 5`}>
      {'★'.repeat(full)}
      {half ? '½' : ''}
      <span className="dim">{'☆'.repeat(5 - full - (half ? 1 : 0))}</span>
    </span>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="ms-tags">
      {tags.slice(0, 6).map((t) => (
        <span key={t} className="badge">{t}</span>
      ))}
    </div>
  );
}

function Words({ words, label = 'Trigger words' }: { words: string[]; label?: string }) {
  if (!words.length) return null;
  return (
    <div className="ms-words">
      <span className="ms-words-label">{label}</span>
      {words.map((w) => (
        <span key={w} className="badge blue">{w}</span>
      ))}
    </div>
  );
}

function Empty({ what, q }: { what: string; q: string }) {
  return <div className="empty">{q ? `No ${what} match “${q}”.` : `No ${what} in this bundle.`}</div>;
}

// ---------------------------------------------------------------------------

export function CopyCardsSection({ bundle, q, actions }: { bundle: ContentBundle; q: string; actions: MyStudioActions }) {
  const [open, setOpen] = useState<CopyCard | null>(null);
  const needle = q.toLowerCase();
  const items = useMemo(() => bundle.copyCards.filter((c) => anyHas([c.title, c.text, c.category, ...c.tags], needle)), [bundle, needle]);
  const groups = useMemo(() => {
    const m = new Map<string, CopyCard[]>();
    for (const c of items) {
      const k = c.category ?? '';
      (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  if (!items.length) return <Empty what="copy cards" q={q} />;
  return (
    <>
      <p className="muted small ms-hint">Tap a card to add it to your prompt. Long text? Tap the title to read it all.</p>
      {groups.map(([cat, cards]) => (
        <div key={cat || '_'}>
          {cat && <div className="section-title">{cat}</div>}
          <div className="card" style={{ padding: 0 }}>
            {cards.map((c) => (
              <div key={c.id} className="list-item ms-item" onClick={() => actions.insertCopy(c)}>
                <div className="title">
                  <div className="ms-item-title" onClick={(e) => { e.stopPropagation(); setOpen(c); }}>{c.title}</div>
                  <div className="ms-text">{c.text}</div>
                  <Tags tags={c.tags} />
                </div>
                <button className="icon-btn" aria-label="Add to prompt" onClick={(e) => { e.stopPropagation(); actions.insertCopy(c); }}>
                  <Icon name="plus" size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {open && (
        <Sheet
          title={open.title}
          onClose={() => setOpen(null)}
          footer={
            <div className="row">
              <button className="btn" style={{ flex: 1 }} onClick={() => { actions.insertCopy(open, 'replace'); setOpen(null); }}>Replace prompt</button>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => { actions.insertCopy(open); setOpen(null); }}>
                <Icon name="plus" size={16} /> Add to prompt
              </button>
            </div>
          }
        >
          <div className="card ms-pre">{open.text}</div>
          {open.negative && (
            <>
              <div className="section-title">Negative</div>
              <div className="card ms-pre">{open.negative}</div>
            </>
          )}
          {open.notes && <p className="muted small">{open.notes}</p>}
          <p className="muted small mono">{open.source}</p>
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export function RecipesSection({ bundle, q, actions }: { bundle: ContentBundle; q: string; actions: MyStudioActions }) {
  const [open, setOpen] = useState<StudioRecipe | null>(null);
  const needle = q.toLowerCase();
  const items = useMemo(
    () => bundle.recipes.filter((r) => anyHas([r.name, r.engine, r.baseModel, r.kind, r.notes, ...r.triggerWords, ...r.loras.map((l) => l.file), ...r.tags], needle)),
    [bundle, needle],
  );
  if (!items.length) return <Empty what="recipes" q={q} />;
  return (
    <>
      <p className="muted small ms-hint">
        A recipe is how the author says a LoRA should be used: trigger words + their settings. <strong>Use</strong> makes it the active recipe for <strong>{actions.template.name}</strong> — the trigger words are added to your prompt when you generate.
      </p>
      <div className="card" style={{ padding: 0 }}>
        {items.map((r) => {
          const onServer = r.loras.map((l) => actions.serverFileFor(l.file));
          const anyMissing = onServer.some((f) => !f) && r.loras.length > 0;
          return (
            <div key={r.id} className="list-item ms-item" onClick={() => setOpen(r)}>
              <div className="title">
                <div className="ms-item-title">
                  {prettyName(r.name)}
                  {r.engine && <span className="badge" style={{ marginLeft: 6 }}>{r.engine}</span>}
                </div>
                <Words words={r.triggerWords} />
                {r.loras.length > 0 && (
                  <div className="sub ellipsis">
                    LoRA: {r.loras.map((l) => prettyName(l.file)).join(', ')}{' '}
                    {actions.serverLoras && <span className={`badge ${anyMissing ? 'amber' : 'green'}`}>{anyMissing ? 'not on server' : 'on server'}</span>}
                  </div>
                )}
                {Object.keys(r.settings).length > 0 && <div className="sub ellipsis">{summariseSettings(r.settings)}</div>}
              </div>
              <button className="btn sm primary" onClick={(e) => { e.stopPropagation(); actions.useRecipe(r); }}>Use</button>
            </div>
          );
        })}
      </div>
      {open && (
        <Sheet
          title={prettyName(open.name)}
          onClose={() => setOpen(null)}
          footer={
            <div className="row">
              {open.triggerWords.length > 0 && (
                <button className="btn" style={{ flex: 1 }} onClick={() => { actions.setPrompt(open.triggerWords.join(', '), 'append'); setOpen(null); }}>
                  Insert trigger words only
                </button>
              )}
              <button className="btn primary" style={{ flex: 1 }} onClick={() => { actions.useRecipe(open); setOpen(null); }}>Use recipe</button>
            </div>
          }
        >
          <Words words={open.triggerWords} />
          {open.loras.length > 0 && (
            <>
              <div className="section-title">LoRA files</div>
              <div className="card" style={{ padding: 0 }}>
                {open.loras.map((l) => {
                  const sf = actions.serverFileFor(l.file);
                  return (
                    <div key={l.file} className="list-item" style={{ cursor: 'default' }}>
                      <div className="title">
                        <div className="ellipsis mono small">{l.file}</div>
                        <div className="sub">{l.strength !== undefined ? `strength ${l.strength} · ` : ''}{sf ? `on server as ${sf}` : actions.serverLoras ? 'not in models/loras on this server' : 'server list not loaded'}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {Object.keys(open.settings).length > 0 && (
            <>
              <div className="section-title">Author settings</div>
              <div className="card mono small ms-kv">
                {Object.entries(open.settings).map(([k, v]) => (
                  <div key={k}><span className="muted">{k}</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                ))}
              </div>
            </>
          )}
          {open.prompt && (
            <>
              <div className="section-title">Prompt format</div>
              <div className="card ms-pre">{open.prompt}</div>
            </>
          )}
          {open.notes && <p className="small">{open.notes}</p>}
          <p className="muted small mono">
            {[open.kind, open.baseModel, open.civitai?.url ? `civitai ${open.civitai.modelId ?? ''}/${open.civitai.versionId ?? ''}` : null].filter(Boolean).join(' · ')}
            <br />
            {open.source}
          </p>
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export function LoraLabSection({ bundle, q, actions }: { bundle: ContentBundle; q: string; actions: MyStudioActions }) {
  const [onlyServer, setOnlyServer] = useState(false);
  const [onlyRated, setOnlyRated] = useState(false);
  const [choose, setChoose] = useState<string | null>(null);
  const [open, setOpen] = useState<LoraIndexEntry | null>(null);
  const needle = q.toLowerCase();
  const byKey = useContentStore((s) => s.loraIndex.byKey);
  const index = useMemo(() => Object.values(byKey), [byKey]);
  void bundle;

  const items = useMemo(
    () =>
      index
        .filter((e) => anyHas([e.key, e.card?.name, e.card?.notes, e.card?.engine, e.card?.baseModel, ...e.triggerWords, ...(e.card?.tags ?? [])], needle))
        .filter((e) => !onlyServer || actions.serverFileFor(e.key))
        .filter((e) => !onlyRated || e.rating !== null)
        .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || Number(!!b.card?.favourite) - Number(!!a.card?.favourite) || a.key.localeCompare(b.key)),
    [index, needle, onlyServer, onlyRated, actions],
  );

  const pick = (file: string) => {
    const r = actions.pickLora(file);
    if (r === 'choose') setChoose(file);
  };

  return (
    <>
      <p className="muted small ms-hint">
        Your rated LoRAs. {actions.serverLoras ? `${actions.serverMatch.matched} of ${index.length} are in models/loras on this server.` : 'Connect to see which are on the server.'} Tap one to put it in the current template’s LoRA slot.
      </p>
      <div className="chips" style={{ marginBottom: 8 }}>
        <button className={`chip${onlyServer ? ' active' : ''}`} onClick={() => setOnlyServer((v) => !v)}>On server</button>
        <button className={`chip${onlyRated ? ' active' : ''}`} onClick={() => setOnlyRated((v) => !v)}>Rated</button>
      </div>
      {!items.length && <Empty what="LoRA cards" q={q} />}
      <div className="card" style={{ padding: 0 }}>
        {items.map((e) => {
          const sf = actions.serverFileFor(e.key);
          return (
            <div key={e.key} className="list-item ms-item" onClick={() => pick(e.card?.file ?? e.key)}>
              <div className="title">
                <div className="ms-item-title ellipsis" onClick={(ev) => { ev.stopPropagation(); setOpen(e); }}>
                  {e.card?.name ?? prettyName(e.key)}
                  {e.card?.favourite && <span className="badge amber" style={{ marginLeft: 6 }}>fav</span>}
                  {e.card?.benched && <span className="badge green" style={{ marginLeft: 6 }}>benched</span>}
                </div>
                <div className="sub">
                  <Stars rating={e.rating} />
                  {e.card?.engine ? ` · ${e.card.engine}` : ''}
                  {actions.serverLoras ? (sf ? ' · on server' : ' · not on server') : ''}
                </div>
                <Words words={e.triggerWords} />
                {e.card?.notes && <div className="ms-text small">{e.card.notes}</div>}
              </div>
              <Icon name="chevron" size={16} />
            </div>
          );
        })}
      </div>

      {choose && (
        <Sheet title="Which LoRA slot?" onClose={() => setChoose(null)}>
          <div className="card" style={{ padding: 0 }}>
            {actions.slots.map((s) => (
              <div key={s.param.key} className="list-item" onClick={() => { actions.pickLora(choose, s); setChoose(null); }}>
                <div className="title">
                  <div>{s.param.label}</div>
                  {s.param.description && <div className="sub">{s.param.description}</div>}
                </div>
                <Icon name="chevron" size={16} />
              </div>
            ))}
          </div>
        </Sheet>
      )}

      {open && (
        <Sheet
          title={open.card?.name ?? prettyName(open.key)}
          onClose={() => setOpen(null)}
          footer={<button className="btn primary block" onClick={() => { setOpen(null); pick(open.card?.file ?? open.key); }}>Use this LoRA</button>}
        >
          <div className="row" style={{ marginBottom: 8 }}>
            <Stars rating={open.rating} />
            {open.card?.strength !== undefined && <span className="badge">strength {open.card.strength}</span>}
            {open.card?.baseModel && <span className="badge">{open.card.baseModel}</span>}
          </div>
          <Words words={open.triggerWords} />
          {open.card?.notes && <div className="card ms-pre" style={{ marginTop: 8 }}>{open.card.notes}</div>}
          <Tags tags={open.card?.tags ?? []} />
          {open.recipes.length > 0 && (
            <>
              <div className="section-title">Recipes using it</div>
              <div className="card" style={{ padding: 0 }}>
                {open.recipes.map((r) => (
                  <div key={r.id} className="list-item" onClick={() => { actions.useRecipe(r); setOpen(null); }}>
                    <div className="title">
                      <div>{prettyName(r.name)}</div>
                      {Object.keys(r.settings).length > 0 && <div className="sub ellipsis">{summariseSettings(r.settings)}</div>}
                    </div>
                    <span className="btn sm">Use</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {open.card && Object.keys(open.card.extra).length > 0 && (
            <>
              <div className="section-title">Other fields</div>
              <div className="card mono small ms-kv">
                {Object.entries(open.card.extra).map(([k, v]) => (
                  <div key={k}><span className="muted">{k}</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                ))}
              </div>
            </>
          )}
          <p className="muted small mono">
            {open.card?.file ?? open.key}
            {actions.serverFileFor(open.key) ? ` → ${actions.serverFileFor(open.key)}` : ''}
            <br />
            {open.card?.source}
          </p>
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export function WorkflowsSection({ bundle, q, actions }: { bundle: ContentBundle; q: string; actions: MyStudioActions }) {
  const [open, setOpen] = useState<BundledWorkflow | null>(null);
  const needle = q.toLowerCase();
  const items = useMemo(() => bundle.workflows.filter((w) => anyHas([w.name, w.engine, w.notes, w.format, ...w.tags], needle)), [bundle, needle]);
  if (!items.length) return <Empty what="workflows" q={q} />;
  return (
    <>
      <p className="muted small ms-hint">Workflows saved in Video Studio. Tap to open in Graph mode; ▶ queues it on the server as-is.</p>
      <div className="card" style={{ padding: 0 }}>
        {items.map((w) => (
          <div key={w.id} className="list-item ms-item" onClick={() => (w.format === 'ui' ? actions.openWorkflow(w) : setOpen(w))}>
            <Icon name="graph" size={20} />
            <div className="title">
              <div className="ms-item-title ellipsis">{prettyName(w.name)}</div>
              <div className="sub">
                {w.nodeCount} nodes{w.engine ? ` · ${w.engine}` : ''} · <span className={`badge ${w.format === 'ui' ? 'green' : w.format === 'api' ? 'amber' : 'red'}`}>{w.format === 'ui' ? 'opens in Graph' : w.format === 'api' ? 'API format · run only' : 'unknown format'}</span>
              </div>
              {w.notes && <div className="ms-text small">{w.notes}</div>}
            </div>
            <button className="icon-btn" aria-label="Run" disabled={!actions.connected} onClick={(e) => { e.stopPropagation(); void actions.runWorkflow(w); }}>
              <Icon name="play" size={18} />
            </button>
            <button className="icon-btn" aria-label="More" onClick={(e) => { e.stopPropagation(); setOpen(w); }}>
              <Icon name="more" size={18} />
            </button>
          </div>
        ))}
      </div>
      {open && (
        <Sheet title={prettyName(open.name)} onClose={() => setOpen(null)}>
          <div className="card" style={{ padding: 0 }}>
            <div className={`list-item${open.format !== 'ui' ? ' ms-disabled' : ''}`} onClick={() => { actions.openWorkflow(open); setOpen(null); }}>
              <Icon name="graph" size={20} />
              <div className="title">Open in Graph mode{open.format !== 'ui' ? ' (UI format only)' : ''}</div>
            </div>
            <div className={`list-item${open.format !== 'ui' ? ' ms-disabled' : ''}`} onClick={() => { actions.saveWorkflow(open); setOpen(null); }}>
              <Icon name="save" size={20} />
              <div className="title">Save to this device</div>
            </div>
            <div className={`list-item${!actions.connected ? ' ms-disabled' : ''}`} onClick={() => { void actions.runWorkflow(open); setOpen(null); }}>
              <Icon name="play" size={20} />
              <div className="title">Run on server now</div>
            </div>
          </div>
          <p className="muted small mono" style={{ marginTop: 10 }}>{open.format} · {open.nodeCount} nodes · {open.source}</p>
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export function PresetsSection({ bundle, q, actions }: { bundle: ContentBundle; q: string; actions: MyStudioActions }) {
  const needle = q.toLowerCase();
  const items = useMemo(() => bundle.presets.filter((p) => anyHas([p.name, p.engine, p.notes, p.prompt, ...p.tags], needle)), [bundle, needle]);
  if (!items.length) return <Empty what="presets" q={q} />;
  return (
    <>
      <p className="muted small ms-hint">Saved settings. Tap to apply what fits onto <strong>{actions.template.name}</strong> (steps, cfg, size, frames…); unmatched keys are listed in the toast.</p>
      <div className="card" style={{ padding: 0 }}>
        {items.map((p) => (
          <div key={p.id} className="list-item ms-item" onClick={() => actions.applyPreset(p, false)}>
            <div className="title">
              <div className="ms-item-title">
                {p.name}
                {p.engine && <span className="badge" style={{ marginLeft: 6 }}>{p.engine}</span>}
              </div>
              <div className="sub ellipsis">{summariseSettings(p.values, 8) || 'no settings'}</div>
              {p.prompt && <div className="ms-text small">“{p.prompt}”</div>}
            </div>
            {p.prompt && (
              <button className="btn sm" onClick={(e) => { e.stopPropagation(); actions.applyPreset(p, true); }}>+ prompt</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

export function MoreSection({ bundle, q, actions }: { bundle: ContentBundle; q: string; actions: MyStudioActions }) {
  const needle = q.toLowerCase();
  const chars = bundle.characters.filter((c) => anyHas([c.name, c.description, ...c.tags, ...c.triggerWords], needle));
  const assets = bundle.assets.filter((a) => anyHas([a.name, a.kind, a.path, ...a.tags], needle));
  const raw = Object.values(bundle.raw).filter((r) => anyHas([r.source, r.kind], needle));
  return (
    <>
      {chars.length > 0 && (
        <>
          <div className="section-title">Characters ({chars.length})</div>
          <p className="muted small ms-hint">Tap to add the character’s description and trigger words to your prompt.</p>
          <div className="card" style={{ padding: 0 }}>
            {chars.map((c) => (
              <div
                key={c.id}
                className="list-item ms-item"
                onClick={() => actions.insertCopy({ id: c.id, source: c.source, title: c.name, text: [...c.triggerWords, c.description ?? ''].filter(Boolean).join(', '), tags: c.tags })}
              >
                <div className="title">
                  <div className="ms-item-title">{c.name}</div>
                  {c.description && <div className="ms-text small">{c.description}</div>}
                  <Words words={c.triggerWords} />
                  {c.loras.length > 0 && <div className="sub ellipsis">LoRA: {c.loras.map(prettyName).join(', ')}</div>}
                </div>
                <Icon name="plus" size={18} />
              </div>
            ))}
          </div>
        </>
      )}
      {assets.length > 0 && (
        <>
          <div className="section-title">Assets ({assets.length})</div>
          <p className="muted small ms-hint">Names and metadata only — the files stay on the Mac.</p>
          <div className="card" style={{ padding: 0 }}>
            {assets.map((a) => (
              <div key={a.id} className="list-item" style={{ cursor: 'default' }}>
                <div className="title">
                  <div className="ellipsis">{a.name}</div>
                  <div className="sub ellipsis">{[a.kind, a.path, summariseSettings(a.meta, 4)].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="section-title">Unclassified sources ({raw.length})</div>
      <p className="muted small ms-hint">Files the exporter read but could not place. They are kept in the bundle so nothing is lost; paste the digest to get them mapped.</p>
      <div className="card" style={{ padding: 0 }}>
        {raw.length === 0 && <div className="empty">Everything was classified.</div>}
        {raw.map((r) => (
          <div key={r.source} className="list-item" style={{ cursor: 'default' }}>
            <div className="title">
              <div className="ellipsis mono small">{r.source}</div>
              <div className="sub ellipsis">{r.kind} · {JSON.stringify(r.shape).slice(0, 120)}</div>
            </div>
          </div>
        ))}
      </div>
      {bundle.skipped.length > 0 && (
        <>
          <div className="section-title">Skipped ({bundle.skipped.length})</div>
          <div className="card" style={{ padding: 0 }}>
            {bundle.skipped.map((s) => (
              <div key={s.source} className="list-item" style={{ cursor: 'default' }}>
                <div className="title">
                  <div className="ellipsis mono small">{s.source}</div>
                  <div className="sub ellipsis">{s.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
