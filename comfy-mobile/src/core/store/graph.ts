/**
 * Current workflow being edited (shared by Graph mode and Studio's
 * "Open in Graph"). Keeps an undo/redo history and autosaves to localStorage.
 */
import { create } from 'zustand';
import type { ObjectInfo } from '../api/types';
import {
  cloneNode,
  connect,
  createNode,
  disconnectInput,
  removeLink,
  removeNode,
  resolveWorkflow,
  setWidgetValue,
  updateNode,
} from '../graph/model';
import { exportWorkflow, parseWorkflow } from '../graph/serialize';
import { applyControl, type ControlValue } from '../graph/widgets';
import { emptyWorkflow, type GraphNode, type NodeMode, type Workflow } from '../graph/types';
import { useServerStore } from './server';

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface GraphState {
  workflow: Workflow;
  /** Display name of the current workflow (saved name or template name). */
  name: string;
  /** Id in the saved-workflows store, when this graph was loaded from one. */
  savedId: string | null;
  /** Studio template this graph was created from (so Studio can read it back). */
  templateId: string | null;
  dirty: boolean;
  selectedNodeId: number | null;
  viewport: Viewport;
  undoStack: Workflow[];
  redoStack: Workflow[];

  load: (wf: Workflow, opts?: { name?: string; savedId?: string | null; templateId?: string | null }) => void;
  loadJson: (json: string | unknown, name?: string) => void;
  newWorkflow: () => void;
  setName: (name: string) => void;
  select: (id: number | null) => void;
  setViewport: (vp: Viewport) => void;

  addNode: (type: string, pos: [number, number]) => GraphNode | null;
  removeNode: (id: number) => void;
  cloneNode: (id: number) => void;
  moveNode: (id: number, pos: [number, number]) => void;
  patchNode: (id: number, patch: Partial<GraphNode>) => void;
  setMode: (id: number, mode: NodeMode) => void;
  setWidget: (id: number, widget: string, value: unknown) => void;
  connect: (fromNode: number, fromSlot: number, toNode: number, toSlot: number) => void;
  disconnectInput: (nodeId: number, slot: number) => void;
  removeLink: (linkId: number) => void;
  /** Applies "control after generate" to every seed-like widget. */
  applyControls: () => void;
  undo: () => void;
  redo: () => void;
  /** Re-resolve widgets when object_info arrives/changes. */
  reresolve: (info: ObjectInfo | null) => void;
}

const AUTOSAVE_KEY = 'comfy-mobile.currentWorkflow';
const MAX_UNDO = 60;

function info(): ObjectInfo | null {
  return useServerStore.getState().objectInfo;
}

function readAutosave(): { wf: Workflow; name: string; savedId: string | null; templateId: string | null } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { workflow: unknown; name?: string; savedId?: string | null; templateId?: string | null };
    return {
      wf: parseWorkflow(data.workflow, null),
      name: data.name ?? 'Unsaved workflow',
      savedId: data.savedId ?? null,
      templateId: data.templateId ?? null,
    };
  } catch {
    return null;
  }
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutosave(get: () => GraphState) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const s = get();
    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({ workflow: exportWorkflow(s.workflow), name: s.name, savedId: s.savedId, templateId: s.templateId }),
      );
    } catch {
      /* quota */
    }
  }, 400);
}

const restored = readAutosave();

export const useGraphStore = create<GraphState>()((set, get) => {
  /** Applies a workflow mutation with undo bookkeeping. */
  const mutate = (fn: (wf: Workflow) => Workflow, opts: { undoable?: boolean } = {}) => {
    const { workflow, undoStack } = get();
    const next = fn(workflow);
    if (next === workflow) return;
    set({
      workflow: next,
      dirty: true,
      ...(opts.undoable === false
        ? {}
        : { undoStack: [...undoStack.slice(-MAX_UNDO + 1), workflow], redoStack: [] }),
    });
    scheduleAutosave(get);
  };

  return {
    workflow: restored?.wf ?? emptyWorkflow(),
    name: restored?.name ?? 'Unsaved workflow',
    savedId: restored?.savedId ?? null,
    templateId: restored?.templateId ?? null,
    dirty: false,
    selectedNodeId: null,
    viewport: { x: 40, y: 80, scale: 0.8 },
    undoStack: [],
    redoStack: [],

    load: (wf, opts) => {
      set({
        workflow: resolveWorkflow(wf, info()),
        name: opts?.name ?? get().name,
        savedId: opts?.savedId === undefined ? null : opts.savedId,
        templateId: opts?.templateId === undefined ? null : opts.templateId,
        dirty: false,
        selectedNodeId: null,
        undoStack: [],
        redoStack: [],
      });
      scheduleAutosave(get);
    },
    loadJson: (json, name) => {
      const wf = parseWorkflow(json, info());
      get().load(wf, { name: name ?? 'Imported workflow' });
    },
    newWorkflow: () => get().load(emptyWorkflow(), { name: 'Untitled workflow' }),
    setName: (name) => {
      set({ name, dirty: true });
      scheduleAutosave(get);
    },
    select: (id) => set({ selectedNodeId: id }),
    setViewport: (viewport) => set({ viewport }),

    addNode: (type, pos) => {
      let created: GraphNode | null = null;
      mutate((wf) => {
        const r = createNode(wf, type, pos, info());
        created = r.node;
        return r.wf;
      });
      return created;
    },
    removeNode: (id) => {
      mutate((wf) => removeNode(wf, id));
      if (get().selectedNodeId === id) set({ selectedNodeId: null });
    },
    cloneNode: (id) => mutate((wf) => cloneNode(wf, id, info())),
    moveNode: (id, pos) =>
      mutate(
        (wf) => ({ ...wf, nodes: wf.nodes.map((n) => (n.id === id ? { ...n, pos } : n)) }),
        { undoable: false },
      ),
    patchNode: (id, patch) => mutate((wf) => updateNode(wf, id, patch)),
    setMode: (id, mode) => mutate((wf) => updateNode(wf, id, { mode })),
    setWidget: (id, widget, value) => mutate((wf) => setWidgetValue(wf, id, widget, value)),
    connect: (a, b, c, d) => mutate((wf) => connect(wf, a, b, c, d)),
    disconnectInput: (nodeId, slot) => mutate((wf) => disconnectInput(wf, nodeId, slot)),
    removeLink: (linkId) => mutate((wf) => removeLink(wf, linkId)),

    applyControls: () =>
      mutate(
        (wf) => {
          let next = wf;
          for (const node of wf.nodes) {
            (node.widgets ?? []).forEach((w, i) => {
              if (w.kind !== 'control' || !w.options.controls) return;
              const control = (node.widgets_values[i] ?? 'randomize') as ControlValue;
              const targetIdx = node.widgets!.findIndex((x) => x.name === w.options.controls);
              if (targetIdx < 0) return;
              const target = node.widgets![targetIdx];
              const current = Number(node.widgets_values[targetIdx] ?? 0);
              const updated = applyControl(current, control, target);
              if (updated !== current) next = setWidgetValue(next, node.id, target.name, updated);
            });
          }
          return next;
        },
        { undoable: false },
      ),

    undo: () => {
      const { undoStack, redoStack, workflow } = get();
      const prev = undoStack[undoStack.length - 1];
      if (!prev) return;
      set({ workflow: prev, undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, workflow], dirty: true });
      scheduleAutosave(get);
    },
    redo: () => {
      const { undoStack, redoStack, workflow } = get();
      const next = redoStack[redoStack.length - 1];
      if (!next) return;
      set({ workflow: next, redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, workflow], dirty: true });
      scheduleAutosave(get);
    },
    reresolve: (objectInfo) => set((s) => ({ workflow: resolveWorkflow(s.workflow, objectInfo) })),
  };
});

// Re-resolve widgets whenever object_info is (re)loaded.
useServerStore.subscribe((s, prev) => {
  if (s.objectInfo !== prev.objectInfo) useGraphStore.getState().reresolve(s.objectInfo);
});
