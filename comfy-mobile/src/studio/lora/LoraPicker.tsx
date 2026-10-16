/**
 * LoRA Lab extension point (stub with working basics).
 *
 * Lists LoRA files from the server (`/models/loras`) with a local 0–5 rating,
 * trigger words and favourite flag (persisted in `useLorasStore`). Two modes:
 *   - single (`value` + `onSelect`): pick one file for a template param;
 *   - multi (`selected` + `onToggle`): tick/untick files for the Studio LoRA
 *     stack, capped at `max`.
 * Search is word-AND over the file path, so "wan grain" finds
 * `wan/film_grain_v3.safetensors` among 1500+ entries. Only the first
 * `PAGE` matches render until the user narrows the search or taps "Show more".
 */
import { useEffect, useMemo, useState } from 'react';
import { matchesQuery, useLorasStore, useServerStore } from '../../core';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';

const PAGE = 150;

interface SingleProps {
  value: string;
  onSelect: (file: string) => void;
  onClose: () => void;
}
interface MultiProps {
  selected: string[];
  onToggle: (file: string) => void;
  max: number;
  onClose: () => void;
}
type Props = SingleProps | MultiProps;

export function LoraPicker(props: Props) {
  const multi = 'selected' in props;
  const files = useServerStore((s) => s.modelLists.loras);
  const refreshModels = useServerStore((s) => s.refreshModels);
  const meta = useLorasStore((s) => s.meta);
  const setMeta = useLorasStore((s) => s.setMeta);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!files) void refreshModels('loras');
  }, [files, refreshModels]);

  const list = useMemo(() => {
    const selected = multi ? new Set(props.selected) : new Set<string>();
    return (files ?? [])
      .filter((f) => matchesQuery(f, q))
      .sort((a, b) => Number(selected.has(b)) - Number(selected.has(a)) || (meta[b]?.rating ?? 0) - (meta[a]?.rating ?? 0) || a.localeCompare(b));
  }, [files, q, meta, multi, props]);

  const shown = list.slice(0, limit);
  const full = multi && props.selected.length >= props.max;

  const isActive = (f: string) => (multi ? props.selected.includes(f) : f === props.value);
  const pick = (f: string) => {
    if (multi) {
      if (!props.selected.includes(f) && full) return;
      props.onToggle(f);
    } else {
      props.onSelect(f);
      props.onClose();
    }
  };

  return (
    <Sheet
      title={multi ? `LoRAs (${props.selected.length}/${props.max})` : 'LoRA'}
      onClose={props.onClose}
      full
      footer={
        multi ? (
          <button className="btn primary block" onClick={props.onClose}>
            Done
          </button>
        ) : undefined
      }
    >
      <input
        className="input"
        placeholder={files ? `Search ${files.length} LoRAs… (e.g. "wan grain")` : 'Search LoRAs…'}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setLimit(PAGE);
        }}
        autoFocus
        style={{ marginBottom: 8 }}
      />
      {multi && full && <div className="field-hint" style={{ marginBottom: 8 }}>Stack is full — untick one to add another.</div>}
      {!files && <div className="empty">Loading…</div>}
      {files && files.length === 0 && <div className="empty">No LoRA files in models/loras on the server.</div>}
      {files && files.length > 0 && list.length === 0 && <div className="empty">Nothing matches “{q}”.</div>}
      <div className="card" style={{ padding: 0 }}>
        {shown.map((f) => {
          const m = meta[f];
          const active = isActive(f);
          const disabled = multi && !active && full;
          return (
            <div key={f} className={`list-item${active ? ' active' : ''}`} style={disabled ? { opacity: 0.5 } : undefined} onClick={() => pick(f)}>
              {multi && <span className={`check-box${active ? ' on' : ''}`} aria-hidden>{active && <Icon name="check" size={14} />}</span>}
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
      {list.length > shown.length && (
        <button className="btn block" style={{ marginTop: 8 }} onClick={() => setLimit((n) => n + PAGE)}>
          Show more ({list.length - shown.length} more match{list.length - shown.length === 1 ? '' : 'es'})
        </button>
      )}

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
