/**
 * Queue a My Studio card by loading its workflow from `/studio-thumbs/` and
 * writing only the prompt and, when a new photo was picked, the image.
 * Every other widget stays as it is in the file.
 *
 * The file is either a UI graph (`{ nodes: [...] }`) or an API prompt
 * (`{ "<id>": { class_type, inputs } }`).
 */
import type { ApiPrompt } from '../api/types';
import type { GraphNode, Workflow } from '../graph/types';
import { STUDIO_THUMBS_ROOT, studioThumbUrl } from './studioThumbs';

export const SETTINGS_NOT_IN_BUILD = "This card's settings are not in the build.";

export interface StudioWidgetEdit {
  nodeId: number;
  field: string;
  value: string;
}

function patchNode(node: GraphNode, edit: StudioWidgetEdit): GraphNode | null {
  const widgets = node.widgets ?? [];
  const idx = widgets.findIndex((w) => w.name === edit.field);
  if (idx < 0) return null;
  const widgets_values = [...node.widgets_values];
  widgets_values[idx] = edit.value;
  const named = node.widgets_values_named;
  const widgets_values_named =
    named && Object.prototype.hasOwnProperty.call(named, edit.field) ? { ...named, [edit.field]: edit.value } : named;
  return { ...node, widgets_values, widgets_values_named };
}

/**
 * Writes `edit` onto the first node with that id: root nodes, then subgraph
 * inner nodes. Returns null when that node has no widget by `field`.
 */
function writeWidget(wf: Workflow, edit: StudioWidgetEdit): Workflow | null {
  if (wf.nodes.some((n) => n.id === edit.nodeId)) {
    let wrote = false;
    const nodes = wf.nodes.map((n) => {
      if (n.id !== edit.nodeId) return n;
      const next = patchNode(n, edit);
      if (!next) return n;
      wrote = true;
      return next;
    });
    return wrote ? { ...wf, nodes } : null;
  }
  const defs = wf.definitions?.subgraphs;
  if (!defs?.length) return null;
  let wrote = false;
  let missed = false;
  const subgraphs = defs.map((d) => {
    if (wrote || missed) return d;
    const idx = d.nodes.findIndex((n) => n.id === edit.nodeId);
    if (idx < 0) return d;
    const next = patchNode(d.nodes[idx], edit);
    if (!next) {
      missed = true;
      return d;
    }
    wrote = true;
    const nodes = d.nodes.slice();
    nodes[idx] = next;
    return { ...d, nodes };
  });
  if (!wrote) return null;
  return { ...wf, definitions: { subgraphs } };
}

/**
 * Applies the prompt edit and, when present, the image edit.
 * An omitted or null edit is left alone. A named widget that is not on the
 * resolved node is reported in `missed` and that part of the graph is unchanged.
 */
export function applyStudioRunEdits(
  wf: Workflow,
  edits: { prompt?: StudioWidgetEdit | null; image?: StudioWidgetEdit | null },
): { workflow: Workflow; missed: Array<'prompt' | 'image'> } {
  let workflow = wf;
  const missed: Array<'prompt' | 'image'> = [];
  for (const key of ['prompt', 'image'] as const) {
    const edit = edits[key];
    if (!edit) continue;
    const next = writeWidget(workflow, edit);
    if (!next) missed.push(key);
    else workflow = next;
  }
  return { workflow, missed };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A text box, including Pixaroma's text node. Not every node that happens to store a string. */
export function isTextWidgetNode(type: string): boolean {
  if (type === 'PixaromaText' || type === 'Text Pixaroma') return true;
  if (/CLIPText/i.test(type)) return true;
  if (type === 'Text' || type.startsWith('Text ') || type.endsWith(' Text') || type.endsWith('Text')) return true;
  return false;
}

function widgetSlotIndex(node: Record<string, unknown>, field: string): number {
  if (!Array.isArray(node.inputs)) return -1;
  let i = 0;
  for (const input of node.inputs) {
    const slot = asRecord(input);
    const widget = slot ? asRecord(slot.widget) : null;
    const name = widget && typeof widget.name === 'string' ? widget.name : null;
    if (!name) continue;
    if (name === field) return i;
    i++;
  }
  return -1;
}

function loneStringIndex(values: unknown[]): number {
  let found = -1;
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] !== 'string') continue;
    if (found >= 0) return -1;
    found = i;
  }
  return found;
}

/**
 * Replaces the string `field` names inside `widgets_values`. A slot that is
 * not a string is left alone, and so is every other entry.
 */
function replaceStringWidget(node: Record<string, unknown>, field: string): number {
  if (!Array.isArray(node.widgets_values)) return -1;
  const values = node.widgets_values;
  const namedSlot = widgetSlotIndex(node, field);
  if (namedSlot >= 0) return typeof values[namedSlot] === 'string' ? namedSlot : -1;
  return loneStringIndex(values);
}

function patchUiNode(node: Record<string, unknown>, edit: StudioWidgetEdit, kind: 'prompt' | 'image'): boolean {
  const named = asRecord(node.widgets_values_named);
  if (named && Object.prototype.hasOwnProperty.call(named, edit.field)) {
    named[edit.field] = edit.value;
    // Keep the positional string in step when it is the same widget, so a
    // converter that still reads `widgets_values` submits the new text.
    if (Array.isArray(node.widgets_values)) {
      const idx = replaceStringWidget(node, edit.field);
      if (idx >= 0) {
        const widgets_values = node.widgets_values.slice();
        widgets_values[idx] = edit.value;
        node.widgets_values = widgets_values;
      }
    }
    return true;
  }
  const textNode = isTextWidgetNode(String(node.type ?? ''));
  if (kind === 'prompt' && !textNode) return false;
  if (!Array.isArray(node.widgets_values)) return false;
  const idx = replaceStringWidget(node, edit.field);
  if (idx < 0) return false;
  const widgets_values = node.widgets_values.slice();
  widgets_values[idx] = edit.value;
  node.widgets_values = widgets_values;
  return true;
}

function findUiNode(root: Record<string, unknown>, nodeId: number): Record<string, unknown> | null {
  const nodes = Array.isArray(root.nodes) ? root.nodes : [];
  for (const item of nodes) {
    const node = asRecord(item);
    if (node && Number(node.id) === nodeId) return node;
  }
  const definitions = asRecord(root.definitions);
  const subgraphs = definitions && Array.isArray(definitions.subgraphs) ? definitions.subgraphs : [];
  for (const item of subgraphs) {
    const def = asRecord(item);
    const inner = def && Array.isArray(def.nodes) ? def.nodes : [];
    for (const innerItem of inner) {
      const node = asRecord(innerItem);
      if (node && Number(node.id) === nodeId) return node;
    }
  }
  return null;
}

function uiGraphBody(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (Array.isArray(raw.nodes)) return raw;
  const wrapped = asRecord(raw.workflow);
  if (wrapped && Array.isArray(wrapped.nodes)) return wrapped;
  return null;
}

function isApiPrompt(raw: Record<string, unknown>): boolean {
  const vals = Object.values(raw);
  return vals.length > 0 && vals.every((v) => {
    const node = asRecord(v);
    return !!node && typeof node.class_type === 'string';
  });
}

export type PatchedStudioFile =
  | { format: 'ui'; workflow: unknown; missed: Array<'prompt' | 'image'> }
  | { format: 'api'; prompt: ApiPrompt; missed: Array<'prompt' | 'image'> }
  | { format: 'unknown'; missed: Array<'prompt' | 'image'> };

/**
 * Patches a workflow file before it is queued.
 * UI graphs: `widgets_values_named[field]` when that key exists; otherwise a
 * text node's string widget (PixaromaText included). API prompts: `inputs[field]`.
 * An omitted edit is skipped. Nothing else in the file is written.
 */
export function patchStudioRunFile(
  raw: unknown,
  edits: { prompt?: StudioWidgetEdit | null; image?: StudioWidgetEdit | null },
): PatchedStudioFile {
  const root = asRecord(raw);
  const requested = (['prompt', 'image'] as const).filter((key) => edits[key]);
  if (!root) return { format: 'unknown', missed: requested };
  const copy = structuredClone(root);
  const ui = uiGraphBody(copy);
  if (ui) {
    const missed: Array<'prompt' | 'image'> = [];
    for (const key of ['prompt', 'image'] as const) {
      const edit = edits[key];
      if (!edit) continue;
      const node = findUiNode(ui, edit.nodeId);
      if (!node || !patchUiNode(node, edit, key)) missed.push(key);
    }
    return { format: 'ui', workflow: copy, missed };
  }
  if (isApiPrompt(copy)) {
    const missed: Array<'prompt' | 'image'> = [];
    for (const key of ['prompt', 'image'] as const) {
      const edit = edits[key];
      if (!edit) continue;
      const node = asRecord(copy[String(edit.nodeId)]);
      const inputs = node ? asRecord(node.inputs) : null;
      if (!node || !inputs) {
        missed.push(key);
        continue;
      }
      inputs[edit.field] = edit.value;
    }
    return { format: 'api', prompt: copy as ApiPrompt, missed };
  }
  return { format: 'unknown', missed: requested };
}

/** GET `/studio-thumbs/<workflowFile>`. An unsafe path or a failed fetch throws. */
export async function loadStudioWorkflowFile(workflowFile: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const url = studioThumbUrl(workflowFile);
  if (!url?.startsWith(STUDIO_THUMBS_ROOT)) throw new Error(SETTINGS_NOT_IN_BUILD);
  const res = await fetchImpl(url, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error(SETTINGS_NOT_IN_BUILD);
  return res.json();
}
