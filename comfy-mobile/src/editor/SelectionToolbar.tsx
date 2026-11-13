/** Floating actions for the selected node (ComfyUI "selection toolbox"). */
import { NODE_MODE_ALWAYS, NODE_MODE_BYPASS, NODE_MODE_MUTED, nodeTitle, useGraphStore, useSettingsStore } from '../core';
import { Icon } from '../shared/Icon';
import { useUiStore } from '../shared/ui';

export function SelectionToolbar({ nodeId, onEdit, top }: { nodeId: number; onEdit: () => void; top: number }) {
  const node = useGraphStore((s) => s.workflow.nodes.find((n) => n.id === nodeId));
  const { setMode, cloneNode, removeNode, select } = useGraphStore();
  const confirmDelete = useSettingsStore((s) => s.confirmDelete);
  const ask = useUiStore((s) => s.ask);
  if (!node) return null;
  return (
    <div className="selection-toolbar" style={{ top }}>
      <button onClick={onEdit}>
        <Icon name="edit" /> Edit
      </button>
      <button className={node.mode === NODE_MODE_BYPASS ? 'active' : ''} onClick={() => setMode(node.id, node.mode === NODE_MODE_BYPASS ? NODE_MODE_ALWAYS : NODE_MODE_BYPASS)}>
        <Icon name="bypass" /> Bypass
      </button>
      <button className={node.mode === NODE_MODE_MUTED ? 'active' : ''} onClick={() => setMode(node.id, node.mode === NODE_MODE_MUTED ? NODE_MODE_ALWAYS : NODE_MODE_MUTED)}>
        <Icon name="mute" /> Mute
      </button>
      <button onClick={() => cloneNode(node.id)}>
        <Icon name="copy" /> Clone
      </button>
      <button
        onClick={async () => {
          if (confirmDelete) {
            const ok = await ask({ title: `Delete ${nodeTitle(node)}?`, confirmLabel: 'Delete', danger: true });
            if (!ok) return;
          }
          removeNode(node.id);
          select(null);
        }}
      >
        <Icon name="trash" /> Delete
      </button>
    </div>
  );
}
