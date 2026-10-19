/**
 * Import / export of ComfyUI workflow JSON.
 *
 * The internal model *is* the LiteGraph serialised format plus derived fields
 * (`widgets`, `missing`), so exporting is mostly stripping those fields.
 */
import type { ObjectInfo } from '../api/types';
import { resolveWorkflow } from './model';
import { emptyWorkflow, type GraphLink, type GraphNode, type SubgraphDefinition, type SubgraphSlot, type Workflow } from './types';

export class WorkflowParseError extends Error {}

/** Parses workflow JSON text (or an already-parsed object). */
export function parseWorkflow(input: string | unknown, info: ObjectInfo | null): Workflow {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new WorkflowParseError('Not valid JSON');
    }
  }
  if (!raw || typeof raw !== 'object') throw new WorkflowParseError('Workflow must be an object');
  const obj = raw as Record<string, unknown>;

  // Some exporters wrap the workflow (e.g. {"workflow": {...}}).
  if (!Array.isArray(obj.nodes) && obj.workflow && typeof obj.workflow === 'object') {
    return parseWorkflow(obj.workflow, info);
  }
  if (!Array.isArray(obj.nodes)) {
    if (looksLikeApiPrompt(obj)) {
      throw new WorkflowParseError(
        'This is an API-format prompt, not a workflow. Export the workflow (not "API") from ComfyUI.',
      );
    }
    throw new WorkflowParseError('Missing "nodes" array');
  }

  const nodes: GraphNode[] = (obj.nodes as unknown[]).map((n, i) => normaliseNode(n, i));
  const links: GraphLink[] = Array.isArray(obj.links)
    ? (obj.links as unknown[]).map(normaliseLink).filter((l): l is GraphLink => !!l)
    : [];

  const wf: Workflow = {
    ...emptyWorkflow(),
    last_node_id: num(obj.last_node_id, Math.max(0, ...nodes.map((n) => n.id))),
    last_link_id: num(obj.last_link_id, Math.max(0, ...links.map((l) => l[0]))),
    nodes,
    links,
    groups: Array.isArray(obj.groups) ? (obj.groups as Workflow['groups']) : [],
    config: (obj.config as Record<string, unknown>) ?? {},
    extra: (obj.extra as Record<string, unknown>) ?? {},
    version: typeof obj.version === 'number' ? obj.version : 0.4,
  };
  const subgraphs = normaliseDefinitions(obj.definitions);
  if (subgraphs.length) wf.definitions = { subgraphs };
  return resolveWorkflow(wf, info);
}

function normaliseDefinitions(raw: unknown): SubgraphDefinition[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as Record<string, unknown>).subgraphs;
  if (!Array.isArray(list)) return [];
  const out: SubgraphDefinition[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (typeof d.id !== 'string' || !d.id) continue;
    const { id, name, nodes, links, inputs, outputs, ...rest } = d;
    out.push({
      id,
      name: typeof name === 'string' && name.trim() ? name : 'Subgraph',
      nodes: Array.isArray(nodes) ? nodes.map((n, i) => normaliseNode(n, i)) : [],
      links: Array.isArray(links) ? links.map(normaliseLink).filter((l): l is GraphLink => !!l) : [],
      inputs: normaliseSubgraphSlots(inputs),
      outputs: normaliseSubgraphSlots(outputs),
      rest,
    });
  }
  return out;
}

function normaliseSubgraphSlots(raw: unknown): SubgraphSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return {
      id: typeof o.id === 'string' ? o.id : undefined,
      name: String(o.name ?? `slot_${i}`),
      type: String(o.type ?? '*'),
      linkIds: Array.isArray(o.linkIds) ? (o.linkIds as unknown[]).filter((l): l is number => typeof l === 'number') : [],
      label: typeof o.label === 'string' ? o.label : undefined,
    };
  });
}

function looksLikeApiPrompt(obj: Record<string, unknown>): boolean {
  const vals = Object.values(obj);
  return vals.length > 0 && vals.every((v) => v && typeof v === 'object' && 'class_type' in (v as object));
}

function namedWidgetMap(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return { ...(v as Record<string, unknown>) };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function normaliseNode(raw: unknown, index: number): GraphNode {
  const n = (raw ?? {}) as Record<string, unknown>;
  const pos = Array.isArray(n.pos)
    ? [num(n.pos[0], 0), num(n.pos[1], 0)]
    : n.pos && typeof n.pos === 'object'
      ? [num((n.pos as Record<string, unknown>)['0'], 0), num((n.pos as Record<string, unknown>)['1'], 0)]
      : [index * 40, index * 40];
  const size = Array.isArray(n.size)
    ? [num(n.size[0], 0), num(n.size[1], 0)]
    : n.size && typeof n.size === 'object'
      ? [num((n.size as Record<string, unknown>)['0'], 0), num((n.size as Record<string, unknown>)['1'], 0)]
      : [0, 0];
  return {
    id: num(n.id, index + 1),
    type: String(n.type ?? 'Unknown'),
    title: typeof n.title === 'string' ? n.title : undefined,
    pos: pos as [number, number],
    size: size as [number, number],
    flags: (n.flags as GraphNode['flags']) ?? {},
    order: num(n.order, index),
    mode: ([0, 2, 4].includes(n.mode as number) ? n.mode : 0) as GraphNode['mode'],
    inputs: Array.isArray(n.inputs)
      ? (n.inputs as Record<string, unknown>[]).map((s) => ({
          name: String(s.name ?? ''),
          type: String(s.type ?? '*'),
          link: typeof s.link === 'number' ? s.link : null,
          widget: s.widget as GraphNode['inputs'][number]['widget'],
          label: typeof s.label === 'string' ? s.label : undefined,
        }))
      : [],
    outputs: Array.isArray(n.outputs)
      ? (n.outputs as Record<string, unknown>[]).map((s, i) => ({
          name: String(s.name ?? ''),
          type: String(s.type ?? '*'),
          links: Array.isArray(s.links) ? (s.links as number[]).filter((l) => typeof l === 'number') : [],
          slot_index: typeof s.slot_index === 'number' ? s.slot_index : i,
          label: typeof s.label === 'string' ? s.label : undefined,
        }))
      : [],
    properties: (n.properties as Record<string, unknown>) ?? {},
    widgets_values: (n.widgets_values as unknown[]) ?? [],
    widgets_values_named: namedWidgetMap(n.widgets_values_named),
    color: typeof n.color === 'string' ? n.color : undefined,
    bgcolor: typeof n.bgcolor === 'string' ? n.bgcolor : undefined,
  };
}

function normaliseLink(raw: unknown): GraphLink | null {
  if (Array.isArray(raw) && raw.length >= 5) {
    return [
      Number(raw[0]),
      Number(raw[1]),
      Number(raw[2]),
      Number(raw[3]),
      Number(raw[4]),
      String(raw[5] ?? '*'),
    ];
  }
  // Newer frontends may serialise links as objects.
  if (raw && typeof raw === 'object') {
    const l = raw as Record<string, unknown>;
    if ('id' in l && 'origin_id' in l) {
      return [
        Number(l.id),
        Number(l.origin_id),
        Number(l.origin_slot),
        Number(l.target_id),
        Number(l.target_slot),
        String(l.type ?? '*'),
      ];
    }
  }
  return null;
}

/** Strips derived fields and returns a plain ComfyUI workflow object. */
export function exportWorkflow(wf: Workflow): Record<string, unknown> {
  const out: Record<string, unknown> = {
    last_node_id: wf.last_node_id,
    last_link_id: wf.last_link_id,
    nodes: wf.nodes.map(exportNode),
    links: wf.links,
    groups: wf.groups,
    config: wf.config,
    extra: wf.extra,
    version: wf.version,
  };
  if (wf.definitions?.subgraphs.length) {
    out.definitions = {
      subgraphs: wf.definitions.subgraphs.map((d) => ({
        ...d.rest,
        id: d.id,
        name: d.name,
        inputs: d.inputs.map(exportSubgraphSlot),
        outputs: d.outputs.map(exportSubgraphSlot),
        nodes: d.nodes.map(exportNode),
        links: d.links,
      })),
    };
  }
  return out;
}

function exportSubgraphSlot(s: SubgraphSlot): Record<string, unknown> {
  const o: Record<string, unknown> = { name: s.name, type: s.type, linkIds: s.linkIds };
  if (s.id) o.id = s.id;
  if (s.label) o.label = s.label;
  return o;
}

function exportNode(n: GraphNode): Record<string, unknown> {
  const { widgets: _w, missing: _m, ...rest } = n;
  const out: Record<string, unknown> = {
    id: rest.id,
    type: rest.type,
    pos: rest.pos,
    size: rest.size,
    flags: rest.flags ?? {},
    order: rest.order,
    mode: rest.mode,
    inputs: rest.inputs.map((s) => {
      const slot: Record<string, unknown> = { name: s.name, type: s.type, link: s.link };
      if (s.widget) slot.widget = s.widget;
      if (s.label) slot.label = s.label;
      return slot;
    }),
    outputs: rest.outputs.map((s, i) => {
      const slot: Record<string, unknown> = { name: s.name, type: s.type, links: s.links, slot_index: s.slot_index ?? i };
      if (s.label) slot.label = s.label;
      return slot;
    }),
    properties: rest.properties ?? {},
    widgets_values: rest.widgets_values,
  };
  if (rest.widgets_values_named) out.widgets_values_named = rest.widgets_values_named;
  if (rest.title) out.title = rest.title;
  if (rest.color) out.color = rest.color;
  if (rest.bgcolor) out.bgcolor = rest.bgcolor;
  return out;
}

export function workflowToJson(wf: Workflow, pretty = true): string {
  return JSON.stringify(exportWorkflow(wf), null, pretty ? 2 : undefined);
}
