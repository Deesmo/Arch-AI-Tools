/**
 * Bottom sheet for editing one node: title, mode, colour, every widget, and
 * the connection state of each slot.
 */
import { useState } from 'react';
import {
  NODE_COLORS,
  NODE_MODE_ALWAYS,
  NODE_MODE_BYPASS,
  NODE_MODE_MUTED,
  nodeTitle,
  typeColor,
  useGraphStore,
  useServerStore,
  type NodeMode,
} from '../core';
import { Icon } from '../shared/Icon';
import { Sheet } from '../shared/Sheet';
import { useUiStore } from '../shared/ui';
import { WidgetEditor } from './WidgetEditor';

export function NodeInspector({ nodeId, onClose }: { nodeId: number; onClose: () => void }) {
  const node = useGraphStore((s) => s.workflow.nodes.find((n) => n.id === nodeId));
  const workflow = useGraphStore((s) => s.workflow);
  const { setWidget, setMode, patchNode, removeNode, cloneNode, disconnectInput } = useGraphStore();
  const info = useServerStore((s) => s.objectInfo);
  const nodeErrors = useServerStore((s) => s.nodeErrors);
  const ask = useUiStore((s) => s.ask);
  const [editingTitle, setEditingTitle] = useState(false);

  if (!node) return null;
  const def = info?.[node.type];
  const errors = nodeErrors[String(node.id)];

  const modes: { mode: NodeMode; label: string }[] = [
    { mode: NODE_MODE_ALWAYS, label: 'Always' },
    { mode: NODE_MODE_MUTED, label: 'Mute' },
    { mode: NODE_MODE_BYPASS, label: 'Bypass' },
  ];

  const linkOrigin = (linkId: number | null) => {
    if (linkId == null) return null;
    const link = workflow.links.find((l) => l[0] === linkId);
    if (!link) return null;
    const origin = workflow.nodes.find((n) => n.id === link[1]);
    return origin ? `${nodeTitle(origin)} › ${origin.outputs[link[2]]?.name ?? link[2]}` : null;
  };

  return (
    <Sheet
      title={nodeTitle(node)}
      onClose={onClose}
      full
      headerExtra={
        <button className="icon-btn" onClick={() => setEditingTitle((v) => !v)} aria-label="Rename">
          <Icon name="edit" size={18} />
        </button>
      }
      footer={
        <>
          <button className="btn" onClick={() => cloneNode(node.id)}>
            <Icon name="copy" size={16} /> Clone
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              const ok = await ask({ title: `Delete ${nodeTitle(node)}?`, confirmLabel: 'Delete', danger: true });
              if (ok) {
                removeNode(node.id);
                onClose();
              }
            }}
          >
            <Icon name="trash" size={16} /> Delete
          </button>
          <button className="btn primary" style={{ flex: 1 }} onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {editingTitle && (
        <div className="field">
          <label>Title</label>
          <input className="input" value={node.title ?? ''} placeholder={def?.display_name ?? node.type} onChange={(e) => patchNode(node.id, { title: e.target.value || undefined })} autoFocus />
        </div>
      )}
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="muted small mono">
          {node.type} · #{node.id}
        </span>
        <div className="segmented">
          {modes.map((m) => (
            <button key={m.mode} className={node.mode === m.mode ? 'active' : ''} onClick={() => setMode(node.id, m.mode)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {node.missing && (
        <div className="card" style={{ borderColor: 'var(--error-text)', marginBottom: 10 }}>
          <strong className="error-text">Node type not available on this server.</strong>
          <div className="muted small">Install the custom node pack that provides “{node.type}”, or replace this node.</div>
        </div>
      )}
      {errors && (
        <div className="card" style={{ borderColor: 'var(--error-text)', marginBottom: 10 }}>
          {errors.errors.map((e, i) => (
            <div key={i} className="small">
              <strong className="error-text">{e.message}</strong> <span className="muted">{e.details}</span>
            </div>
          ))}
        </div>
      )}
      {def?.description && <p className="muted small" style={{ marginTop: 0 }}>{def.description}</p>}

      {(node.widgets ?? []).filter((w) => w.kind !== 'control' && !w.isConvertedToInput).map((w) => {
        const idx = node.widgets!.indexOf(w);
        const controlIdx = node.widgets!.findIndex((c) => c.kind === 'control' && c.options.controls === w.name);
        return (
          <div className="field" key={w.name}>
            <label>
              {w.label ?? w.name} <span className="mono muted">{w.type}</span>
            </label>
            <WidgetEditor
              node={node}
              widget={w}
              value={node.widgets_values[idx]}
              onChange={(v) => setWidget(node.id, w.name, v)}
              controlValue={controlIdx >= 0 ? String(node.widgets_values[controlIdx] ?? 'randomize') : undefined}
              onChangeControl={controlIdx >= 0 ? (c) => setWidget(node.id, node.widgets![controlIdx].name, c) : undefined}
            />
            {w.options.tooltip && <div className="field-hint">{w.options.tooltip}</div>}
          </div>
        );
      })}

      {node.inputs.length > 0 && (
        <>
          <div className="section-title">Inputs</div>
          <div className="card" style={{ padding: 0 }}>
            {node.inputs.map((s, i) => (
              <div className="list-item" key={`${s.name}-${i}`} style={{ cursor: 'default' }}>
                <span className="conn-dot" style={{ background: typeColor(s.type) }} />
                <div className="title">
                  <div>
                    {s.name} <span className="mono muted">{s.type}</span>
                  </div>
                  <div className="sub">{linkOrigin(s.link) ?? (s.optional ? 'optional · not connected' : 'not connected')}</div>
                </div>
                {s.link != null && (
                  <button className="icon-btn" onClick={() => disconnectInput(node.id, i)} aria-label="Disconnect">
                    <Icon name="unlink" size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {node.outputs.length > 0 && (
        <>
          <div className="section-title">Outputs</div>
          <div className="card" style={{ padding: 0 }}>
            {node.outputs.map((s, i) => (
              <div className="list-item" key={`${s.name}-${i}`} style={{ cursor: 'default' }}>
                <span className="conn-dot" style={{ background: typeColor(s.type) }} />
                <div className="title">
                  <div>
                    {s.name} <span className="mono muted">{s.type}</span>
                  </div>
                  <div className="sub">{s.links.length ? `${s.links.length} connection${s.links.length > 1 ? 's' : ''}` : 'not connected'}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Colour</div>
      <div className="chips">
        <button className={`chip${!node.color ? ' active' : ''}`} onClick={() => patchNode(node.id, { color: undefined, bgcolor: undefined })}>
          default
        </button>
        {Object.entries(NODE_COLORS).map(([name, c]) => (
          <button
            key={name}
            className={`chip${node.color === c.color ? ' active' : ''}`}
            style={{ background: c.bgcolor, borderColor: c.color }}
            onClick={() => patchNode(node.id, { color: c.color, bgcolor: c.bgcolor })}
          >
            {name.replace('_', ' ')}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={() => patchNode(node.id, { flags: { ...node.flags, collapsed: !node.flags?.collapsed } })}>
          <Icon name="collapse" size={16} /> {node.flags?.collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
    </Sheet>
  );
}
