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
 *  - subgraph instances are expanded into their inner nodes, with ids
 *    prefixed by the instance id (`117:5`, nested `117:5:2`) exactly like
 *    the frontend's executable-node flattening. Links across the boundary
 *    are rewired to the real origin; a subgraph input left unconnected on
 *    the instance takes the instance's promoted widget value.
 *
 * A subgraph instance whose definition is missing from the workflow cannot
 * be expanded. It is reported in `unexpanded` (never silently dropped) so the
 * caller refuses to queue — the server would otherwise fail validation with a
 * bare node id (`KeyError('117')`).
 */
import type { ApiPrompt } from '../api/types';
import { getWidgetValue, isVirtualNode, nodeTitle } from './model';
import {
  NODE_MODE_BYPASS,
  NODE_MODE_MUTED,
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
  SUBGRAPH_TYPE_RE,
  type GraphLink,
  type GraphNode,
  type SubgraphDefinition,
  type WidgetDef,
  type Workflow,
} from './types';

export type ResolvedOrigin =
  | { kind: 'link'; nodeId: string; slot: number }
  | { kind: 'value'; value: unknown }
  | { kind: 'none' };

export interface UnexpandedSubgraph {
  /** Instance node id (prefixed when nested). */
  id: string;
  /** The UUID the node carries as its type. */
  type: string;
  /** Instance title, or the UUID when it has none. */
  name: string;
}

export interface PromptBuildResult {
  prompt: ApiPrompt;
  /** Node ids that were skipped because they are muted / virtual / bypassed. */
  skipped: string[];
  /** Subgraph instances that were expanded: instance id → definition name + inner node count. */
  expanded: { id: string; name: string; nodes: number }[];
  /** Subgraph instances with no definition in the workflow. Do not queue while this is non-empty. */
  unexpanded: UnexpandedSubgraph[];
}

/** Message for the user when a subgraph could not be expanded. */
export function unexpandedMessage(list: UnexpandedSubgraph[]): string {
  const names = list.map((u) => u.name);
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
  return `Can't run this yet — subgraph ${shown} didn't expand (no definition in the workflow)`;
}

/** Combo widgets hold strings for display; when the server declared a
 * non-string choice (CreateVideo bit_depth `["auto", 8, 10]`) send that
 * original value, otherwise ComfyUI's combo validation rejects `"8"`. */
export function promptWidgetValue(widget: WidgetDef, value: unknown): unknown {
  const raw = widget.options.rawValues;
  if (widget.kind !== 'combo' || !raw) return value;
  const match = raw.find((r) => String(r) === String(value));
  return match === undefined ? value : match;
}

/** Returns true if the node should be included in the API prompt. */
export function isExecutableNode(node: GraphNode): boolean {
  if (isVirtualNode(node)) return false;
  if (node.mode === NODE_MODE_MUTED || node.mode === NODE_MODE_BYPASS) return false;
  if (node.missing) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

/** One level of the graph: the root workflow or the inside of a subgraph instance. */
interface Scope {
  /** `''` at the root, `'117:'` inside instance 117, `'117:5:'` one level deeper. */
  prefix: string;
  nodes: GraphNode[];
  links: GraphLink[];
  def?: SubgraphDefinition;
  /** The instance node this scope expands, in its parent scope. */
  instance?: { node: GraphNode; scope: Scope };
}

interface Flat {
  defs: Map<string, SubgraphDefinition>;
  /** Full instance id → scope expanding it. */
  scopes: Map<string, Scope>;
  exec: { id: string; node: GraphNode; scope: Scope }[];
  skipped: string[];
  expanded: PromptBuildResult['expanded'];
  unexpanded: UnexpandedSubgraph[];
}

const WIDGET_INPUT_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);

function collect(flat: Flat, scope: Scope, chain: string[]): void {
  const ordered = [...scope.nodes].sort((a, b) => a.order - b.order);
  for (const node of ordered) {
    const id = `${scope.prefix}${node.id}`;
    const def = flat.defs.get(node.type);
    if (def) {
      if (node.mode === NODE_MODE_MUTED || node.mode === NODE_MODE_BYPASS || chain.includes(def.id) || chain.length > 8) {
        flat.skipped.push(id);
        continue;
      }
      const child: Scope = { prefix: `${id}:`, nodes: def.nodes, links: def.links, def, instance: { node, scope } };
      flat.scopes.set(id, child);
      flat.expanded.push({ id, name: def.name, nodes: def.nodes.length });
      collect(flat, child, [...chain, def.id]);
      continue;
    }
    if (SUBGRAPH_TYPE_RE.test(node.type) && node.mode !== NODE_MODE_MUTED) {
      flat.unexpanded.push({ id, type: node.type, name: node.title || node.type });
      continue;
    }
    if (!isExecutableNode(node)) {
      flat.skipped.push(id);
      continue;
    }
    flat.exec.push({ id, node, scope });
  }
}

/** Index of a subgraph input among those that carry a promoted widget on the instance. */
function promotedWidgetIndex(scope: Scope, inputIndex: number): number {
  const def = scope.def!;
  const inst = scope.instance!.node;
  const widgetBacked = (i: number): boolean => {
    const input = def.inputs[i];
    if (!input) return false;
    if (inst.inputs[i]?.widget) return true;
    if (WIDGET_INPUT_TYPES.has(input.type.toUpperCase())) return true;
    return def.links.some(([, o, os, t, ts]) => {
      if (o !== SUBGRAPH_INPUT_NODE_ID || os !== i) return false;
      const target = def.nodes.find((n) => n.id === t);
      return !!target?.inputs[ts]?.widget;
    });
  };
  if (!widgetBacked(inputIndex)) return -1;
  let k = 0;
  for (let i = 0; i < inputIndex; i++) if (widgetBacked(i)) k++;
  return k;
}

/** Value the instance node holds for a subgraph input that is not linked on the outside. */
function promotedWidgetValue(scope: Scope, inputIndex: number): unknown {
  const k = promotedWidgetIndex(scope, inputIndex);
  if (k < 0) return undefined;
  const values = scope.instance!.node.widgets_values ?? [];
  return k < values.length ? values[k] : undefined;
}

/**
 * Newer frontends promote arbitrary inner widgets onto the instance via
 * `properties.proxyWidgets: [[innerNodeId, widgetName], …]`, serialised
 * after the input-backed widgets in `widgets_values`. Applied only when the
 * counts line up, so a mismatch falls back to the definition's own values.
 */
function proxyWidgetOverrides(scope: Scope): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const inst = scope.instance?.node;
  const def = scope.def;
  if (!inst || !def) return out;
  const proxies = inst.properties?.proxyWidgets;
  if (!Array.isArray(proxies) || !proxies.length) return out;
  let backed = 0;
  for (let i = 0; i < def.inputs.length; i++) if (promotedWidgetIndex(scope, i) >= 0) backed++;
  const values = inst.widgets_values ?? [];
  if (values.length !== backed + proxies.length) return out;
  proxies.forEach((p, i) => {
    if (Array.isArray(p) && p.length >= 2) out.set(`${String(p[0])}\u0000${String(p[1])}`, values[backed + i]);
  });
  return out;
}

function bypassIndex(node: GraphNode, outSlot: number): number {
  const outType = node.outputs[outSlot]?.type;
  // Prefer an input of the same type; fall back to same slot index.
  let idx = node.inputs.findIndex((s) => s.type === outType && s.link != null);
  if (idx < 0) idx = node.inputs.findIndex((s) => s.type === outType);
  if (idx < 0 && node.inputs[outSlot]) idx = outSlot;
  return idx;
}

/** Follows a link back through reroutes, bypassed nodes and subgraph boundaries to a real origin. */
function resolve(flat: Flat, scope: Scope, linkId: number | null, depth: number): ResolvedOrigin {
  if (linkId == null || depth > 64) return { kind: 'none' };
  const link = scope.links.find((l) => l[0] === linkId);
  if (!link) return { kind: 'none' };
  const [, originId, originSlot] = link;

  // Coming from the subgraph's own input: continue on the instance's input in the parent scope.
  if (originId === SUBGRAPH_INPUT_NODE_ID) {
    const inst = scope.instance;
    if (!inst || !scope.def) return { kind: 'none' };
    const name = scope.def.inputs[originSlot]?.name;
    let slot = name ? inst.node.inputs.find((s) => s.name === name) : undefined;
    slot ??= inst.node.inputs[originSlot];
    if (slot?.link != null) {
      const outer = resolve(flat, inst.scope, slot.link, depth + 1);
      if (outer.kind !== 'none') return outer;
    }
    const value = promotedWidgetValue(scope, originSlot);
    return value === undefined ? { kind: 'none' } : { kind: 'value', value };
  }

  const origin = scope.nodes.find((n) => n.id === originId);
  if (!origin) return { kind: 'none' };
  if (origin.mode === NODE_MODE_MUTED) return { kind: 'none' };
  if (origin.type === 'Reroute') return resolve(flat, scope, origin.inputs[0]?.link ?? null, depth + 1);
  if (origin.type === 'PrimitiveNode') return { kind: 'value', value: origin.widgets_values?.[0] };

  const fullId = `${scope.prefix}${origin.id}`;
  const def = flat.defs.get(origin.type);
  if (def) {
    if (origin.mode === NODE_MODE_BYPASS) {
      const idx = bypassIndex(origin, originSlot);
      return idx < 0 ? { kind: 'none' } : resolve(flat, scope, origin.inputs[idx]?.link ?? null, depth + 1);
    }
    // Output of a subgraph instance: follow the inner link that feeds that output slot.
    const child = flat.scopes.get(fullId);
    if (!child) return { kind: 'none' };
    const inner = child.links.find(([, , , t, ts]) => t === SUBGRAPH_OUTPUT_NODE_ID && ts === originSlot) ?? child.links.find((l) => def.outputs[originSlot]?.linkIds.includes(l[0]));
    return inner ? resolve(flat, child, inner[0], depth + 1) : { kind: 'none' };
  }
  if (origin.mode === NODE_MODE_BYPASS) {
    const idx = bypassIndex(origin, originSlot);
    return idx < 0 ? { kind: 'none' } : resolve(flat, scope, origin.inputs[idx]?.link ?? null, depth + 1);
  }
  return { kind: 'link', nodeId: fullId, slot: originSlot };
}

/** Root-scope resolution (no subgraphs crossed): kept for callers that inspect a single link. */
export function resolveOrigin(wf: Workflow, linkId: number | null): ResolvedOrigin {
  const flat = flatten(wf);
  return resolve(flat, { prefix: '', nodes: wf.nodes, links: wf.links }, linkId, 0);
}

function flatten(wf: Workflow): Flat {
  const flat: Flat = {
    defs: new Map((wf.definitions?.subgraphs ?? []).map((d) => [d.id, d])),
    scopes: new Map(),
    exec: [],
    skipped: [],
    expanded: [],
    unexpanded: [],
  };
  collect(flat, { prefix: '', nodes: wf.nodes, links: wf.links }, []);
  return flat;
}

export function graphToPrompt(wf: Workflow): PromptBuildResult {
  const flat = flatten(wf);
  const prompt: ApiPrompt = {};
  const overrides = new Map<Scope, Map<string, unknown>>();

  for (const { id, node, scope } of flat.exec) {
    const inputs: Record<string, unknown> = {};
    let proxy = overrides.get(scope);
    if (!proxy) overrides.set(scope, (proxy = proxyWidgetOverrides(scope)));

    // Widget values (skipping control widgets which are frontend-only).
    // Nested dynamic-combo widgets are named by dotted path, which is exactly
    // the key the server expects ("format.codec").
    for (const w of node.widgets ?? []) {
      if (w.kind === 'control') continue;
      const key = `${node.id}\u0000${w.name}`;
      inputs[w.name] = promptWidgetValue(w, proxy.has(key) ? proxy.get(key) : getWidgetValue(node, w.name));
    }

    // Slot inputs (including widgets converted to inputs)
    node.inputs.forEach((slot) => {
      const key = slot.widget?.name ?? slot.name;
      const origin = resolve(flat, scope, slot.link, 0);
      if (origin.kind === 'link') {
        inputs[key] = [origin.nodeId, origin.slot];
      } else if (origin.kind === 'value') {
        inputs[key] = origin.value;
      } else if (!slot.widget) {
        // Unconnected regular slot: leave it out; the server validates required inputs.
        delete inputs[key];
      }
    });

    const title = scope.def ? `${scope.def.name} › ${nodeTitle(node)}` : nodeTitle(node);
    prompt[id] = { class_type: node.type, inputs, _meta: { title } };
  }
  return { prompt, skipped: flat.skipped, expanded: flat.expanded, unexpanded: flat.unexpanded };
}
