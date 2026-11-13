/**
 * Graph mode: full node editor with top bar (workflow name, undo/redo, menu),
 * canvas, floating add/fit buttons, selection toolbar and the queue bar with
 * live progress.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  exportWorkflow,
  firstCompatibleInput,
  firstCompatibleOutput,
  nodeTitle,
  saveTextToDevice,
  useGraphStore,
  useServerStore,
  useWorkflowsStore,
  workflowToJson,
} from '../core';
import { Icon } from '../shared/Icon';
import { Sheet } from '../shared/Sheet';
import { useQueue } from '../shared/useQueue';
import { useUiStore } from '../shared/ui';
import { WorkflowsSheet } from '../screens/WorkflowsScreen';
import { GraphCanvas, type PendingLink } from './GraphCanvas';
import { NodeInspector } from './NodeInspector';
import { NodeSearch } from './NodeSearch';
import { SelectionToolbar } from './SelectionToolbar';

export function EditorScreen() {
  const [search, setSearch] = useState<{ pos: [number, number]; pending?: PendingLink } | null>(null);
  const [inspector, setInspector] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [saveAs, setSaveAs] = useState(false);
  const [saveName, setSaveName] = useState('');
  const fitRef = useRef<() => void>(() => undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const { name, savedId, templateId, dirty, selectedNodeId, undoStack, redoStack, workflow } = useGraphStore();
  const { addNode, connect, undo, redo, newWorkflow, setName, loadJson, select } = useGraphStore();
  const saveWorkflow = useWorkflowsStore((s) => s.save);
  const status = useServerStore((s) => s.status);
  const wsState = useServerStore((s) => s.wsState);
  const execution = useServerStore((s) => s.execution);
  const queueRemaining = useServerStore((s) => s.queueRemaining);
  const interrupt = useServerStore((s) => s.interrupt);
  const clearOutputs = useServerStore((s) => s.clearOutputs);
  const { queueCurrentGraph } = useQueue();
  const toast = useUiStore((s) => s.toast);
  const ask = useUiStore((s) => s.ask);
  const setWorkflowsOpen = useUiStore((s) => s.setWorkflowsOpen);
  const workflowsOpen = useUiStore((s) => s.workflowsOpen);

  const registerFit = useCallback((fn: () => void) => {
    fitRef.current = fn;
  }, []);

  // Fit once on first mount when a graph exists.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!fittedRef.current && workflow.nodes.length) {
      fittedRef.current = true;
      setTimeout(() => fitRef.current(), 30);
    }
  }, [workflow.nodes.length]);

  const onPickNode = (type: string) => {
    if (!search) return;
    const node = addNode(type, search.pos);
    if (node && search.pending) {
      const p = search.pending;
      if (p.kind === 'out') {
        const slot = firstCompatibleInput(node, p.type);
        if (slot >= 0) connect(p.nodeId, p.slot, node.id, slot);
      } else {
        const slot = firstCompatibleOutput(node, p.type);
        if (slot >= 0) connect(node.id, slot, p.nodeId, p.slot);
      }
    }
    if (node) select(node.id);
    setSearch(null);
  };

  const doSave = () => {
    if (savedId) {
      saveWorkflow(name, exportWorkflow(workflow), savedId, templateId);
      useGraphStore.setState({ dirty: false });
      toast('Saved', 'success');
    } else {
      setSaveName(name === 'Unsaved workflow' || name === 'Untitled workflow' ? '' : name);
      setSaveAs(true);
    }
  };

  const confirmSaveAs = () => {
    const n = saveName.trim() || 'Untitled workflow';
    const entry = saveWorkflow(n, exportWorkflow(workflow), null, templateId);
    useGraphStore.setState({ name: n, savedId: entry.id, dirty: false });
    setSaveAs(false);
    toast('Saved', 'success');
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
        const { workflowFromPng } = await import('../core/utils/png');
        const wf = workflowFromPng(await file.arrayBuffer());
        if (!wf) throw new Error('No workflow metadata found in that PNG');
        loadJson(wf, file.name.replace(/\.png$/i, ''));
      } else {
        loadJson(await file.text(), file.name.replace(/\.json$/i, ''));
      }
      toast('Workflow imported', 'success');
      setTimeout(() => fitRef.current(), 30);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const running = execution.status === 'running';
  const progressPct = execution.progress && execution.progress.max > 0 ? Math.round((execution.progress.value / execution.progress.max) * 100) : null;
  const executingNode = execution.executingNode ? workflow.nodes.find((n) => String(n.id) === execution.executingNode) : null;

  const statusText = (() => {
    if (status !== 'connected') return status === 'connecting' ? 'Connecting…' : 'Offline — editing only';
    if (running) return `Running ${executingNode ? nodeTitle(executingNode) : '…'}${progressPct !== null ? ` ${progressPct}%` : ''}`;
    if (execution.status === 'error') return `Error: ${execution.error?.message ?? 'execution failed'}`;
    if (execution.status === 'interrupted') return 'Interrupted';
    if (execution.status === 'success') return `Done${execution.startedAt && execution.finishedAt ? ` in ${((execution.finishedAt - execution.startedAt) / 1000).toFixed(1)}s` : ''}`;
    return queueRemaining ? `${queueRemaining} in queue` : 'Idle';
  })();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <GraphCanvas
        onOpenSearch={(pos, pending) => setSearch({ pos, pending })}
        onOpenInspector={(id) => setInspector(id)}
        registerFit={registerFit}
      />

      <div className="editor-topbar">
        <span className={`conn-dot ${status === 'connected' && wsState === 'open' ? 'ok' : status === 'connecting' ? 'busy' : 'bad'}`} />
        <button className="wf-name" onClick={() => setMenu(true)}>
          {name}
          {dirty ? ' •' : ''}
        </button>
        <button className="icon-btn" onClick={undo} disabled={!undoStack.length} aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!redoStack.length} aria-label="Redo">
          <Icon name="redo" />
        </button>
        <button className="icon-btn" onClick={() => setWorkflowsOpen(true)} aria-label="Workflows">
          <Icon name="folder" />
        </button>
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Menu">
          <Icon name="more" />
        </button>
      </div>

      {selectedNodeId !== null && !inspector && (
        <SelectionToolbar nodeId={selectedNodeId} onEdit={() => setInspector(selectedNodeId)} top={60 + 0} />
      )}

      <div className="canvas-fab" style={{ bottom: 120 }}>
        <button className="fab" onClick={() => fitRef.current()} aria-label="Fit to view">
          <Icon name="fit" />
        </button>
        <button
          className="fab primary"
          aria-label="Add node"
          onClick={() => {
            const vp = useGraphStore.getState().viewport;
            const el = document.querySelector('.canvas-root');
            const rect = el?.getBoundingClientRect();
            const cx = ((rect?.width ?? 400) / 2 - vp.x) / vp.scale - 100;
            const cy = ((rect?.height ?? 600) / 2 - vp.y) / vp.scale - 60;
            setSearch({ pos: [cx, cy] });
          }}
        >
          <Icon name="plus" />
        </button>
      </div>

      <div className="queue-bar">
        <div className="status-line">
          {execution.previewUrl && running && <img className="preview" src={execution.previewUrl} alt="preview" />}
          <span className={`ellipsis${execution.status === 'error' ? ' error-text' : ''}`} style={{ flex: 1 }}>
            {statusText}
          </span>
          {queueRemaining > 0 && <span className="badge blue">{queueRemaining} queued</span>}
        </div>
        {(running || status === 'connecting') && (
          <div className={`progress${progressPct === null ? ' indeterminate' : ''}`}>
            <div style={{ width: progressPct === null ? undefined : `${progressPct}%` }} />
          </div>
        )}
        <div className="row">
          <button className="btn primary" style={{ flex: 1 }} disabled={status !== 'connected'} onClick={() => void queueCurrentGraph()}>
            <Icon name="play" size={16} /> Queue Prompt
          </button>
          <button className="btn" disabled={!running && !queueRemaining} onClick={() => void interrupt()} aria-label="Interrupt">
            <Icon name="stop" size={16} />
          </button>
        </div>
      </div>

      {search && <NodeSearch pending={search.pending} onPick={onPickNode} onClose={() => setSearch(null)} />}
      {inspector !== null && <NodeInspector nodeId={inspector} onClose={() => setInspector(null)} />}
      {workflowsOpen && <WorkflowsSheet onClose={() => setWorkflowsOpen(false)} onLoaded={() => setTimeout(() => fitRef.current(), 30)} />}

      {menu && (
        <Sheet title="Workflow" onClose={() => setMenu(false)}>
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="card" style={{ padding: 0 }}>
            <MenuItem icon="save" label={savedId ? 'Save' : 'Save as…'} onClick={() => { setMenu(false); doSave(); }} />
            {savedId && <MenuItem icon="copy" label="Save as copy…" onClick={() => { setMenu(false); setSaveName(`${name} copy`); setSaveAs(true); }} />}
            <MenuItem icon="folder" label="Open workflows & templates" onClick={() => { setMenu(false); setWorkflowsOpen(true); }} />
            <MenuItem icon="upload" label="Import JSON / PNG…" onClick={() => fileRef.current?.click()} />
            <MenuItem icon="download" label="Export JSON" onClick={async () => { await saveTextToDevice(workflowToJson(workflow), `${name.replace(/\s+/g, '_')}.json`); toast('Exported'); setMenu(false); }} />
            <MenuItem icon="refresh" label="Clear node outputs" onClick={() => { clearOutputs(); setMenu(false); }} />
            <MenuItem icon="fit" label="Fit to view" onClick={() => { fitRef.current(); setMenu(false); }} />
            <MenuItem
              icon="plus"
              label="New empty workflow"
              onClick={async () => {
                const ok = !dirty || (await ask({ title: 'Discard unsaved changes?', confirmLabel: 'Discard', danger: true }));
                if (ok) {
                  newWorkflow();
                  setMenu(false);
                }
              }}
            />
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>
            {workflow.nodes.length} nodes · {workflow.links.length} links · format v{workflow.version}
          </p>
          <input ref={fileRef} type="file" accept=".json,application/json,image/png" hidden onChange={(e) => onImportFile(e.target.files?.[0])} />
        </Sheet>
      )}

      {saveAs && (
        <Sheet
          title="Save workflow"
          onClose={() => setSaveAs(false)}
          footer={
            <button className="btn primary block" onClick={confirmSaveAs}>
              Save
            </button>
          }
        >
          <div className="field">
            <label>Name</label>
            <input className="input" value={saveName} onChange={(e) => setSaveName(e.target.value)} autoFocus placeholder="My video workflow" />
          </div>
        </Sheet>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void }) {
  return (
    <div className="list-item" onClick={onClick}>
      <Icon name={icon} size={20} />
      <div className="title">{label}</div>
      <Icon name="chevron" size={16} />
    </div>
  );
}
