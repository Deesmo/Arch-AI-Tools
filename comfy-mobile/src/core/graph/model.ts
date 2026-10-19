/**
 * Pure graph operations. Every function returns a *new* Workflow (immutable
 * updates) so they can be used directly from the zustand store.
 */
import type { NodeDef, ObjectInfo } from '../api/types';
import { DEFAULT_WIDTH, WIDE_WIDTH, nodeHeight } from './layout';
import {
  NODE_MODE_ALWAYS,
  VIRTUAL_NODE_TYPES,
  type GraphLink,
  type GraphNode,
  type NodeInputSlot,
  type NodeMode,
  type WidgetDef,
  type Workflow,
} from './types';
import { defaultWidgetValue, shapeFromDef, virtualNodeShape } from './widgets';

// ---------------------------------------------------------------------------
// Node resolution (attach widget definitions from object_info)
// ---------------------------------------------------------------------------

/**
 * Attaches `widgets` to a node based on object_info, aligning any existing
 * `widgets_values`. Unknown node types are flagged `missing` and keep their
 * serialised slots so the workflow can still be saved/edited.
 */
export function resolveNode(node: GraphNode, info: ObjectInfo | null): GraphNode {
  return resolveNodeWith(node, info, node.widgets_values);
}

/**
 * Like {@link resolveNode} but takes the serialised widget values separately,
 * so callers can re-shape a node from a by-name value map (used when a dynamic
 * combo changes and its nested widgets must be rebuilt).
 */
function resolveNodeWith(node: GraphNode, info: ObjectInfo | null, stored: unknown): GraphNode {
  const def = info?.[node.type];
  const virtual = virtualNodeShape(node.type);
  const shape = virtual ?? (def ? shapeFromDef(def, stored, node.widgets_values_named) : null);
  if (!shape) {
    return { ...node, widgets: node.widgets ?? [], missing: !!info, inputs: node.inputs ?? [], outputs: node.outputs ?? [] };
  }

  // Keep links from the serialised slots; take slot definitions from the server.
  const inputs: NodeInputSlot[] = shape.inputs.map((def) => {
    const existing = (node.inputs ?? []).find((s) => s.name === def.name);
    return { ...def, link: existing?.link ?? null, label: existing?.label };
  });

  // Widgets converted to inputs appear as extra slots carrying `widget: {name}`.
  const widgets: WidgetDef[] = shape.widgets.map((w) => ({ ...w }));
  for (const s of node.inputs ?? []) {
    if (s.widget?.name) {
      const w = widgets.find((x) => x.name === s.widget!.name);
      if (w) {
        w.isConvertedToInput = true;
        inputs.push({ name: s.name, type: s.type, link: s.link ?? null, widget: { name: w.name } });
      }
    }
  }

  const outputs = shape.outputs.map((def, i) => {
    const existing = (node.outputs ?? [])[i];
    return { ...def, links: existing?.links ?? [], label: existing?.label };
  });

  // shapeFromDef already merged `stored` into its values; virtual shapes are static defaults.
  // A PrimitiveNode has no widget defs of its own (its widget mirrors the
  // target input), so its serialised value must survive verbatim: the prompt
  // builder sends it as the literal input value.
  const widgets_values = virtual
    ? widgets.length
      ? alignWidgetValues(stored, widgets, shape.widgetValues)
      : Array.isArray(stored)
        ? stored
        : shape.widgetValues
    : shape.widgetValues;

  const resolved: GraphNode = {
    ...node,
    inputs,
    outputs,
    widgets,
    widgets_values,
    missing: false,
    flags: node.flags ?? {},
    properties: node.properties ?? { 'Node name for S&R': node.type },
    mode: (node.mode ?? NODE_MODE_ALWAYS) as NodeMode,
  };
  if (!resolved.size || resolved.size[0] < 120) {
    resolved.size = [widgets.some((w) => w.options.multiline) ? WIDE_WIDTH : DEFAULT_WIDTH, 0];
  }
  resolved.size = [resolved.size[0], nodeHeight(resolved)];
  return resolved;
}

/** Maps serialised widgets_values (array or legacy object) onto widget defs. */
function alignWidgetValues(raw: unknown, widgets: WidgetDef[], defaults: unknown[]): unknown[] {
  if (Array.isArray(raw)) {
    const out = widgets.map((_, i) => (i < raw.length ? raw[i] : defaults[i]));
    // Old workflows for nodes that have since gained a control widget.
    return out.map((v, i) => (v === undefined || v === null ? defaults[i] : v));
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return widgets.map((w, i) => (w.name in obj ? obj[w.name] : defaults[i]));
  }
  return [...defaults];
}

export function resolveWorkflow(wf: Workflow, info: ObjectInfo | null): Workflow {
  const defs = new Set((wf.definitions?.subgraphs ?? []).map((d) => d.id));
  // A subgraph instance is not a server node type: it expands at queue time,
  // so it is never "missing" while its definition is present.
  const resolve = (n: GraphNode): GraphNode => (defs.has(n.type) ? { ...n, widgets: n.widgets ?? [], missing: false } : resolveNode(n, info));
  const out: Workflow = { ...wf, nodes: wf.nodes.map(resolve) };
  if (wf.definitions) {
    out.definitions = { subgraphs: wf.definitions.subgraphs.map((d) => ({ ...d, nodes: d.nodes.map(resolve) })) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Node creation
// ---------------------------------------------------------------------------

export function createNode(
  wf: Workflow,
  type: string,
  pos: [number, number],
  info: ObjectInfo | null,
): { wf: Workflow; node: GraphNode } {
  const def: NodeDef | undefined = info?.[type];
  const id = wf.last_node_id + 1;
  const base: GraphNode = {
    id,
    type,
    pos: [Math.round(pos[0]), Math.round(pos[1])],
    size: [0, 0],
    flags: {},
    order: wf.nodes.length,
    mode: NODE_MODE_ALWAYS,
    inputs: [],
    outputs: [],
    properties: { 'Node name for S&R': type },
    widgets_values: [],
  };
  if (def?.display_name && def.display_name !== type) base.title = def.display_name;
  const node = resolveNode(base, info);
  return { wf: { ...wf, last_node_id: id, nodes: [...wf.nodes, node] }, node };
}

export function cloneNode(wf: Workflow, nodeId: number, info: ObjectInfo | null): Workflow {
  const src = wf.nodes.find((n) => n.id === nodeId);
  if (!src) return wf;
  const id = wf.last_node_id + 1;
  const copy: GraphNode = {
    ...structuredClone({ ...src, widgets: undefined }),
    id,
    pos: [src.pos[0] + 30, src.pos[1] + 30],
    inputs: src.inputs.map((s) => ({ ...s, link: null })),
    outputs: src.outputs.map((s) => ({ ...s, links: [] })),
    order: wf.nodes.length,
  };
  return { ...wf, last_node_id: id, nodes: [...wf.nodes, resolveNode(copy, info)] };
}

export function removeNode(wf: Workflow, nodeId: number): Workflow {
  const node = wf.nodes.find((n) => n.id === nodeId);
  if (!node) return wf;
  const removedLinks = new Set<number>();
  node.inputs.forEach((s) => s.link != null && removedLinks.add(s.link));
  node.outputs.forEach((s) => s.links.forEach((l) => removedLinks.add(l)));
  const links = wf.links.filter((l) => !removedLinks.has(l[0]));
  const nodes = wf.nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => stripLinks(n, removedLinks));
  return { ...wf, nodes, links };
}

function stripLinks(n: GraphNode, removed: Set<number>): GraphNode {
  const touched =
    n.inputs.some((s) => s.link != null && removed.has(s.link)) ||
    n.outputs.some((s) => s.links.some((l) => removed.has(l)));
  if (!touched) return n;
  return {
    ...n,
    inputs: n.inputs.map((s) => (s.link != null && removed.has(s.link) ? { ...s, link: null } : s)),
    outputs: n.outputs.map((s) => ({ ...s, links: s.links.filter((l) => !removed.has(l)) })),
  };
}

export function updateNode(wf: Workflow, nodeId: number, patch: Partial<GraphNode>): Workflow {
  return {
    ...wf,
    nodes: wf.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const next = { ...n, ...patch };
      next.size = [next.size?.[0] ?? DEFAULT_WIDTH, nodeHeight(next)];
      return next;
    }),
  };
}

/**
 * Sets one widget value. Pass `info` so that changing a dynamic combo
 * (COMFY_DYNAMICCOMBO_V3) rebuilds the nested widgets of the newly selected
 * option: values of unrelated widgets are kept by name, stale nested ones are
 * dropped and the new option's nested inputs start at their defaults.
 */
export function setWidgetValue(wf: Workflow, nodeId: number, widgetName: string, value: unknown, info?: ObjectInfo | null): Workflow {
  return {
    ...wf,
    nodes: wf.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const widgets = n.widgets ?? [];
      const idx = widgets.findIndex((w) => w.name === widgetName);
      if (idx < 0) return n;
      const widgets_values = [...n.widgets_values];
      widgets_values[idx] = value;
      const changed = String(value) !== String(n.widgets_values[idx]);
      if (widgets[idx].options.dynamic && changed && info?.[n.type]) {
        const byName: Record<string, unknown> = {};
        const nestedPrefix = `${widgetName}.`;
        widgets.forEach((w, i) => {
          if (!w.name.startsWith(nestedPrefix)) byName[w.name] = widgets_values[i];
        });
        return resolveNodeWith(n, info, byName);
      }
      return { ...n, widgets_values };
    }),
  };
}

export function getWidgetValue(node: GraphNode, widgetName: string): unknown {
  const idx = (node.widgets ?? []).findIndex((w) => w.name === widgetName);
  if (idx < 0) return undefined;
  const v = node.widgets_values[idx];
  return v === undefined ? defaultWidgetValue(node.widgets![idx]) : v;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** Loose type compatibility check used before connecting (same rules as LiteGraph). */
export function typesCompatible(a: string, b: string): boolean {
  if (!a || !b || a === '*' || b === '*') return true;
  if (a === b) return true;
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return true;
  // Comma-separated unions e.g. "IMAGE,MASK"
  const sa = la.split(',');
  const sb = lb.split(',');
  return sa.some((x) => sb.includes(x));
}

export function disconnectInput(wf: Workflow, nodeId: number, slot: number): Workflow {
  const node = wf.nodes.find((n) => n.id === nodeId);
  const linkId = node?.inputs[slot]?.link;
  if (!node || linkId == null) return wf;
  const removed = new Set([linkId]);
  return {
    ...wf,
    links: wf.links.filter((l) => l[0] !== linkId),
    nodes: wf.nodes.map((n) => stripLinks(n, removed)),
  };
}

export function removeLink(wf: Workflow, linkId: number): Workflow {
  const removed = new Set([linkId]);
  return {
    ...wf,
    links: wf.links.filter((l) => l[0] !== linkId),
    nodes: wf.nodes.map((n) => stripLinks(n, removed)),
  };
}

/** Connects output slot -> input slot, replacing any existing input link. */
export function connect(
  wf: Workflow,
  fromNode: number,
  fromSlot: number,
  toNode: number,
  toSlot: number,
): Workflow {
  if (fromNode === toNode) return wf;
  const origin = wf.nodes.find((n) => n.id === fromNode);
  const target = wf.nodes.find((n) => n.id === toNode);
  const out = origin?.outputs[fromSlot];
  const inp = target?.inputs[toSlot];
  if (!origin || !target || !out || !inp) return wf;
  if (!typesCompatible(out.type, inp.type)) return wf;

  let next = disconnectInput(wf, toNode, toSlot);
  const id = next.last_link_id + 1;
  const type = out.type === '*' ? inp.type : out.type;
  const link: GraphLink = [id, fromNode, fromSlot, toNode, toSlot, type];
  next = {
    ...next,
    last_link_id: id,
    links: [...next.links, link],
    nodes: next.nodes.map((n) => {
      if (n.id === fromNode) {
        return {
          ...n,
          outputs: n.outputs.map((s, i) => (i === fromSlot ? { ...s, links: [...s.links, id] } : s)),
        };
      }
      if (n.id === toNode) {
        return { ...n, inputs: n.inputs.map((s, i) => (i === toSlot ? { ...s, link: id } : s)) };
      }
      return n;
    }),
  };
  return next;
}

export function findLink(wf: Workflow, linkId: number): GraphLink | undefined {
  return wf.links.find((l) => l[0] === linkId);
}

/** First input slot on a node compatible with the given type (for drop-to-connect). */
export function firstCompatibleInput(node: GraphNode, type: string): number {
  const exact = node.inputs.findIndex((s) => s.link == null && s.type === type);
  if (exact >= 0) return exact;
  const loose = node.inputs.findIndex((s) => s.link == null && typesCompatible(s.type, type));
  if (loose >= 0) return loose;
  return node.inputs.findIndex((s) => typesCompatible(s.type, type));
}

export function firstCompatibleOutput(node: GraphNode, type: string): number {
  const exact = node.outputs.findIndex((s) => s.type === type);
  if (exact >= 0) return exact;
  return node.outputs.findIndex((s) => typesCompatible(s.type, type));
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function isVirtualNode(node: GraphNode): boolean {
  return VIRTUAL_NODE_TYPES.has(node.type);
}

export function nodeTitle(node: GraphNode, info?: ObjectInfo | null): string {
  return node.title || info?.[node.type]?.display_name || node.type;
}

/** Bounding box of all nodes: [minX, minY, maxX, maxY]. */
export function graphBounds(wf: Workflow): [number, number, number, number] | null {
  if (!wf.nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of wf.nodes) {
    const w = n.size?.[0] ?? DEFAULT_WIDTH;
    const h = n.size?.[1] ?? nodeHeight(n);
    minX = Math.min(minX, n.pos[0]);
    minY = Math.min(minY, n.pos[1]);
    maxX = Math.max(maxX, n.pos[0] + w);
    maxY = Math.max(maxY, n.pos[1] + h);
  }
  return [minX, minY, maxX, maxY];
}
