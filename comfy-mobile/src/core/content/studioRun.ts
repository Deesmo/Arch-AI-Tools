/**
 * Queue a My Studio card by loading its workflow from `/studio-thumbs/` and
 * writing only the prompt and, when a new photo was picked, the image widget.
 * Every other widget stays as it is in the file.
 */
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
  return { ...node, widgets_values };
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

/** GET `/studio-thumbs/<workflowFile>`. An unsafe path or a failed fetch throws. */
export async function loadStudioWorkflowFile(workflowFile: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const url = studioThumbUrl(workflowFile);
  if (!url?.startsWith(STUDIO_THUMBS_ROOT)) throw new Error(SETTINGS_NOT_IN_BUILD);
  const res = await fetchImpl(url, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error(SETTINGS_NOT_IN_BUILD);
  return res.json();
}
