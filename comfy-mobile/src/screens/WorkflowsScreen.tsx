/**
 * Workflows: bundled templates (with live availability), saved workflows,
 * import from JSON/PNG, and "import-and-run" (queue without opening the graph).
 */
import { useRef, useState } from 'react';
import {
  allTemplates,
  applyTemplate,
  defaultValues,
  describeValidation,
  parseWorkflow,
  saveTextToDevice,
  useGraphStore,
  useServerStore,
  useWorkflowsStore,
  validateTemplate,
  workflowFromPng,
  type SavedWorkflow,
} from '../core';
import { Icon } from '../shared/Icon';
import { Sheet } from '../shared/Sheet';
import { useQueue } from '../shared/useQueue';
import { useUiStore } from '../shared/ui';

export function WorkflowsSheet({ onClose, onLoaded }: { onClose: () => void; onLoaded?: () => void }) {
  const items = useWorkflowsStore((s) => s.items);
  const { remove, duplicate, rename } = useWorkflowsStore();
  const info = useServerStore((s) => s.objectInfo);
  const modelLists = useServerStore((s) => s.modelLists);
  const load = useGraphStore((s) => s.load);
  const loadJson = useGraphStore((s) => s.loadJson);
  const { queueWorkflow } = useQueue();
  const toast = useUiStore((s) => s.toast);
  const ask = useUiStore((s) => s.ask);
  const setTab = useUiStore((s) => s.setTab);
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SavedWorkflow | null>(null);

  const openTemplate = (id: string) => {
    const t = allTemplates().find((x) => x.id === id);
    if (!t) return;
    load(applyTemplate(t, defaultValues(t, info), info), { name: t.name, templateId: t.id });
    setTab('graph');
    onLoaded?.();
    onClose();
  };

  const openSaved = (w: SavedWorkflow) => {
    try {
      load(parseWorkflow(w.workflow, info), { name: w.name, savedId: w.id, templateId: w.templateId ?? null });
      setTab('graph');
      onLoaded?.();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const runSaved = async (w: SavedWorkflow) => {
    try {
      const wf = parseWorkflow(w.workflow, info);
      const id = await queueWorkflow(wf, { source: 'graph', templateId: w.templateId ?? undefined });
      if (id) setTab('queue');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const importText = (text: string | unknown, name: string) => {
    try {
      loadJson(text, name);
      setTab('graph');
      onLoaded?.();
      onClose();
      toast('Imported', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (/\.png$/i.test(file.name) || file.type === 'image/png') {
      const wf = workflowFromPng(await file.arrayBuffer());
      if (!wf) return toast('No workflow metadata in that PNG', 'error');
      importText(wf, file.name.replace(/\.png$/i, ''));
    } else {
      importText(await file.text(), file.name.replace(/\.json$/i, ''));
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Sheet title="Workflows" onClose={onClose} full>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={16} /> Import file
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setPaste('')}>
          <Icon name="edit" size={16} /> Paste JSON
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json,image/png" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      <div className="section-title">Saved on this device ({items.length})</div>
      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 && <div className="empty">No saved workflows yet. Save from Graph mode or import one.</div>}
        {items.map((w) => (
          <div className="list-item" key={w.id} onClick={() => openSaved(w)}>
            <Icon name="graph" size={20} />
            <div className="title">
              <div className="ellipsis">{w.name}</div>
              <div className="sub">
                {(w.workflow as { nodes?: unknown[] }).nodes?.length ?? 0} nodes · {new Date(w.updatedAt).toLocaleString()}
              </div>
            </div>
            <button className="icon-btn" aria-label="Run" onClick={(e) => { e.stopPropagation(); void runSaved(w); }}>
              <Icon name="play" size={18} />
            </button>
            <button
              className="icon-btn"
              aria-label="More"
              onClick={(e) => {
                e.stopPropagation();
                setRenaming(w);
              }}
            >
              <Icon name="more" size={18} />
            </button>
          </div>
        ))}
      </div>

      <div className="section-title">Bundled templates</div>
      <div className="card" style={{ padding: 0 }}>
        {allTemplates().map((t) => {
          const v = validateTemplate(t, info, modelLists);
          return (
            <div className="list-item" key={t.id} onClick={() => openTemplate(t.id)}>
              <Icon name={t.kind.includes('video') ? 'video' : 'image'} size={20} />
              <div className="title">
                <div className="ellipsis">{t.name}</div>
                <div className={`sub${v.missingNodes.length ? ' error-text' : ''}`}>
                  {t.engine} · {describeValidation(v)}
                </div>
              </div>
              <Icon name="chevron" size={16} />
            </div>
          );
        })}
      </div>

      {paste !== null && (
        <Sheet
          title="Paste workflow JSON"
          onClose={() => setPaste(null)}
          footer={
            <button className="btn primary block" onClick={() => { importText(paste, 'Pasted workflow'); setPaste(null); }}>
              Import
            </button>
          }
        >
          <textarea className="textarea mono" style={{ minHeight: 200 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{"nodes": [...], "links": [...]}' />
        </Sheet>
      )}

      {renaming && (
        <Sheet title={renaming.name} onClose={() => setRenaming(null)}>
          <div className="field">
            <label>Name</label>
            <input className="input" defaultValue={renaming.name} onBlur={(e) => rename(renaming.id, e.target.value.trim() || renaming.name)} />
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="list-item" onClick={() => { duplicate(renaming.id); setRenaming(null); }}>
              <Icon name="copy" size={20} />
              <div className="title">Duplicate</div>
            </div>
            <div className="list-item" onClick={async () => { await saveTextToDevice(JSON.stringify(renaming.workflow, null, 2), `${renaming.name}.json`); toast('Exported'); }}>
              <Icon name="download" size={20} />
              <div className="title">Export JSON</div>
            </div>
            <div
              className="list-item"
              onClick={async () => {
                if (await ask({ title: `Delete “${renaming.name}”?`, confirmLabel: 'Delete', danger: true })) {
                  remove(renaming.id);
                  setRenaming(null);
                }
              }}
            >
              <Icon name="trash" size={20} />
              <div className="title error-text">Delete</div>
            </div>
          </div>
        </Sheet>
      )}
    </Sheet>
  );
}
