/**
 * LoRA Lab extension point (stub with working basics).
 *
 * Lists LoRA files from the server (`/models/loras`) with a local 0–5 rating,
 * trigger words and favourite flag (persisted in `useLorasStore`). The Video
 * Studio "LoRA Lab" can replace this component wholesale; keep the props
 * (`value`, `onSelect`, `onClose`) and it will plug into ParamForm unchanged.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLorasStore, useServerStore } from '../../core';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';

export function LoraPicker({ value, onSelect, onClose }: { value: string; onSelect: (file: string) => void; onClose: () => void }) {
  const files = useServerStore((s) => s.modelLists.loras);
  const refreshModels = useServerStore((s) => s.refreshModels);
  const meta = useLorasStore((s) => s.meta);
  const setMeta = useLorasStore((s) => s.setMeta);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!files) void refreshModels('loras');
  }, [files, refreshModels]);

  const list = useMemo(() => {
    const needle = q.toLowerCase();
    return (files ?? [])
      .filter((f) => f.toLowerCase().includes(needle))
      .sort((a, b) => (meta[b]?.rating ?? 0) - (meta[a]?.rating ?? 0) || a.localeCompare(b));
  }, [files, q, meta]);

  return (
    <Sheet title="LoRA" onClose={onClose} full>
      <input className="input" placeholder="Search LoRAs…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      {!files && <div className="empty">Loading…</div>}
      {files && files.length === 0 && <div className="empty">No LoRA files in models/loras on the server.</div>}
      <div className="card" style={{ padding: 0 }}>
        {list.map((f) => {
          const m = meta[f];
          return (
            <div key={f} className={`list-item${f === value ? ' active' : ''}`} onClick={() => { onSelect(f); onClose(); }}>
              <div className="title">
                <div className="ellipsis">{f}</div>
                <div className="sub">
                  {'★'.repeat(m?.rating ?? 0)}
                  {'☆'.repeat(5 - (m?.rating ?? 0))}
                  {m?.triggerWords?.length ? ` · ${m.triggerWords.join(', ')}` : ''}
                </div>
              </div>
              <button className="icon-btn" aria-label="Rate" onClick={(e) => { e.stopPropagation(); setEditing(f); }}>
                <Icon name="edit" size={18} />
              </button>
            </div>
          );
        })}
      </div>

      {editing && (
        <Sheet title={editing} onClose={() => setEditing(null)}>
          <div className="field">
            <label>Rating</label>
            <div className="chips">
              {[0, 1, 2, 3, 4, 5].map((r) => (
                <button key={r} className={`chip${(meta[editing]?.rating ?? 0) === r ? ' active' : ''}`} onClick={() => setMeta(editing, { rating: r })}>
                  {r === 0 ? 'unrated' : '★'.repeat(r)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Trigger words (comma separated)</label>
            <input
              className="input"
              defaultValue={(meta[editing]?.triggerWords ?? []).join(', ')}
              onBlur={(e) => setMeta(editing, { triggerWords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea className="textarea" defaultValue={meta[editing]?.notes ?? ''} onBlur={(e) => setMeta(editing, { notes: e.target.value })} />
          </div>
        </Sheet>
      )}
    </Sheet>
  );
}
