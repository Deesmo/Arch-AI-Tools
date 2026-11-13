/**
 * Node search dialog (the ComfyUI double-click search box). Filters by name,
 * display name and category; when opened from a dangling link only nodes with
 * a compatible slot are shown.
 */
import { useMemo, useState } from 'react';
import { useServerStore, typesCompatible, type NodeDef, VIRTUAL_NODE_TYPES } from '../core';
import { Sheet } from '../shared/Sheet';
import type { PendingLink } from './GraphCanvas';

const VIRTUAL_DEFS: Record<string, { display_name: string; category: string; description: string }> = {
  Note: { display_name: 'Note', category: 'utils', description: 'Free text note (not executed).' },
  Reroute: { display_name: 'Reroute', category: 'utils', description: 'Pass-through point for tidying links.' },
};

function defHasCompatibleSlot(type: string, def: NodeDef | undefined, pending: PendingLink): boolean {
  if (!def) {
    if (type === 'Reroute') return true;
    return false;
  }
  if (pending.kind === 'out') {
    // Need an input of matching type on the candidate node.
    const inputs = { ...(def.input?.required ?? {}), ...(def.input?.optional ?? {}) };
    return Object.values(inputs).some((spec) => {
      const t = Array.isArray(spec[0]) ? 'COMBO' : spec[0];
      return !Array.isArray(spec[0]) && typesCompatible(t, pending.type);
    });
  }
  return (def.output ?? []).some((t) => !Array.isArray(t) && typesCompatible(String(t), pending.type));
}

export function NodeSearch({
  pending,
  onPick,
  onClose,
}: {
  pending?: PendingLink;
  onPick: (type: string) => void;
  onClose: () => void;
}) {
  const info = useServerStore((s) => s.objectInfo);
  const [q, setQ] = useState('');

  const entries = useMemo(() => {
    const list: { type: string; name: string; category: string; description: string }[] = [];
    for (const [type, def] of Object.entries(info ?? {})) {
      if (def.deprecated) continue;
      list.push({ type, name: def.display_name || type, category: def.category ?? '', description: def.description ?? '' });
    }
    for (const type of VIRTUAL_NODE_TYPES) {
      const v = VIRTUAL_DEFS[type];
      if (v) list.push({ type, name: v.display_name, category: v.category, description: v.description });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [info]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = entries;
    if (pending) list = list.filter((e) => defHasCompatibleSlot(e.type, info?.[e.type], pending));
    if (needle) {
      const terms = needle.split(/\s+/);
      list = list.filter((e) => {
        const hay = `${e.name} ${e.type} ${e.category}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
      // Rank: name starts-with first
      list = [...list].sort((a, b) => {
        const as = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
        const bs = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
        return as - bs;
      });
    }
    return list.slice(0, 200);
  }, [entries, q, pending, info]);

  return (
    <Sheet title={pending ? `Add node for ${pending.type}` : 'Add node'} onClose={onClose} full>
      <input
        className="input"
        placeholder={info ? `Search ${entries.length} nodes…` : 'Not connected — only virtual nodes available'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        style={{ marginBottom: 8 }}
      />
      <div className="card search-list" style={{ padding: 0 }}>
        {filtered.length === 0 && <div className="empty">No matching nodes</div>}
        {filtered.map((e) => (
          <div key={e.type} className="search-item" onClick={() => onPick(e.type)}>
            <span className="name">{e.name}</span>
            <span className="cat">
              {e.category}
              {e.name !== e.type ? ` · ${e.type}` : ''}
            </span>
            {e.description && <span className="desc">{e.description}</span>}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
