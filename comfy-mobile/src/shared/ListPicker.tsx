/** Searchable option picker (model files, samplers, ...). */
import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

export function ListPicker({
  title,
  options,
  value,
  onSelect,
  onClose,
  extra,
}: {
  title: string;
  options: string[];
  value: string;
  onSelect: (v: string) => void;
  onClose: () => void;
  extra?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.toLowerCase().includes(needle));
  }, [options, q]);

  return (
    <Sheet title={title} onClose={onClose} full={options.length > 12}>
      {options.length > 8 && (
        <input
          className="input"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          style={{ marginBottom: 8 }}
        />
      )}
      {extra}
      <div className="card" style={{ padding: 0 }}>
        {filtered.length === 0 && <div className="empty">No options</div>}
        {filtered.map((o) => (
          <div
            key={o}
            className={`list-item${o === value ? ' active' : ''}`}
            onClick={() => {
              onSelect(o);
              onClose();
            }}
          >
            <div className="title ellipsis">{o}</div>
            {o === value && <Icon name="check" size={18} />}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
