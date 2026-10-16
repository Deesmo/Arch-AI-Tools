/**
 * Converts the editor graph into the API prompt format expected by POST /prompt.
 *
 * Follows ComfyUI_frontend `graphToPrompt`:
 *  - virtual nodes (Note, Reroute, PrimitiveNode) are never sent
 *  - muted nodes (mode 2) are dropped
 *  - bypassed nodes (mode 4) are skipped by routing their inputs through to
 *    the matching-type input on the other side
 *  - Reroutes are followed to their real origin
 *  - PrimitiveNode outputs become literal widget values
 */
import type { ApiPrompt } from '../api/types';
import { findLink, getWidgetValue, isVirtualNode, nodeTitle } from './model';
import { NODE_MODE_BYPASS, NODE_MODE_MUTED, type GraphNode, type Workflow } from './types';

export type ResolvedOrigin =
  | { kind: 'link'; nodeId: number; slot: number }
  | { kind: 'value'; value: unknown }
  | { kind: 'none' };

export interface PromptBuildResult {
  prompt: ApiPrompt;
  /** Node ids that were skipped because they are muted / virtual / bypassed. */
  skipped: number[];
}

/** Follows a link back through reroutes & bypassed nodes to a real origin. */
export function resolveOrigin(wf: Workflow, linkId: number | null, depth = 0): ResolvedOrigin {
  if (linkId == null || depth > 64) return { kind: 'none' };
  const link = findLink(wf, linkId);
  if (!link) return { kind: 'none' };
  const [, originId, originSlot] = link;
  const origin = wf.nodes.find((n) => n.id === originId);
  if (!origin) return { kind: 'none' };

  if (origin.mode === NODE_MODE_MUTED) return { kind: 'none' };

  if (origin.type === 'Reroute') {
    return resolveOrigin(wf, origin.inputs[0]?.link ?? null, depth + 1);
  }
  if (origin.type === 'PrimitiveNode') {
    return { kind: 'value', value: origin.widgets_values?.[0] };
  }
  if (origin.mode === NODE_MODE_BYPASS) {
    const outType = origin.outputs[originSlot]?.type;
    // Prefer an input of the same type; fall back to same slot index.
    let idx = origin.inputs.findIndex((s) => s.type === outType && s.link != null);
    if (idx < 0) idx = origin.inputs.findIndex((s) => s.type === outType);
    if (idx < 0 && origin.inputs[originSlot]) idx = originSlot;
    if (idx < 0) return { kind: 'none' };
    return resolveOrigin(wf, origin.inputs[idx]?.link ?? null, depth + 1);
  }
  return { kind: 'link', nodeId: originId, slot: originSlot };
}

/** Returns true if the node should be included in the API prompt. */
export function isExecutableNode(node: GraphNode): boolean {
  if (isVirtualNode(node)) return false;
  if (node.mode === NODE_MODE_MUTED || node.mode === NODE_MODE_BYPASS) return false;
  if (node.missing) return false;
  return true;
}

export function graphToPrompt(wf: Workflow): PromptBuildResult {
  const prompt: ApiPrompt = {};
  const skipped: number[] = [];

  const ordered = [...wf.nodes].sort((a, b) => a.order - b.order);
  for (const node of ordered) {
    if (!isExecutableNode(node)) {
      skipped.push(node.id);
      continue;
    }
    const inputs: Record<string, unknown> = {};

    // Widget values (skipping control widgets which are frontend-only)
    for (const w of node.widgets ?? []) {
      if (w.kind === 'control') continue;
      inputs[w.name] = getWidgetValue(node, w.name);
    }

    // Slot inputs (including widgets converted to inputs)
    node.inputs.forEach((slot) => {
      const key = slot.widget?.name ?? slot.name;
      const origin = resolveOrigin(wf, slot.link);
      if (origin.kind === 'link') {
        inputs[key] = [String(origin.nodeId), origin.slot];
      } else if (origin.kind === 'value') {
        inputs[key] = origin.value;
      } else if (!slot.widget) {
        // Unconnected regular slot: leave it out; the server validates required inputs.
        delete inputs[key];
      }
    });

    prompt[String(node.id)] = {
      class_type: node.type,
      inputs,
      _meta: { title: nodeTitle(node) },
    };
  }
  return { prompt, skipped };
}
