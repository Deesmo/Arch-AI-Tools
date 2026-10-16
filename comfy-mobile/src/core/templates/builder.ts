/**
 * Tiny helper for authoring bundled template workflows in TypeScript without
 * hand-maintaining LiteGraph link ids. Output is plain ComfyUI workflow JSON.
 *
 * Slot definitions are only a fallback: when the node type exists in
 * object_info the editor re-derives inputs/outputs from the server and keeps
 * links by input *name* / output *index*, so names must match the server.
 */
import type { NodeMode } from '../graph/types';

export interface NodeSpec {
  id: number;
  type: string;
  title?: string;
  pos: [number, number];
  size?: [number, number];
  mode?: NodeMode;
  widgets_values?: unknown[] | Record<string, unknown>;
  /** [name, type] pairs in server order (slots only, not widgets). */
  inputs?: [string, string][];
  outputs?: [string, string][];
  color?: string;
  bgcolor?: string;
}

/** [fromNodeId, fromSlot, toNodeId, toSlotName, type] */
export type LinkSpec = [number, number, number, string, string];

export function buildWorkflow(nodes: NodeSpec[], links: LinkSpec[]): Record<string, unknown> {
  const outNodes = nodes.map((n, order) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    pos: n.pos,
    size: n.size ?? [0, 0],
    flags: {},
    order,
    mode: n.mode ?? 0,
    inputs: (n.inputs ?? []).map(([name, type]) => ({ name, type, link: null as number | null })),
    outputs: (n.outputs ?? []).map(([name, type], i) => ({ name, type, links: [] as number[], slot_index: i })),
    properties: { 'Node name for S&R': n.type },
    widgets_values: n.widgets_values ?? [],
    color: n.color,
    bgcolor: n.bgcolor,
  }));
  const byId = new Map(outNodes.map((n) => [n.id, n]));
  const outLinks: [number, number, number, number, number, string][] = [];
  links.forEach(([from, fromSlot, to, toSlotName, type], i) => {
    const id = i + 1;
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) throw new Error(`Template link references unknown node ${from} -> ${to}`);
    const toSlot = b.inputs.findIndex((s) => s.name === toSlotName);
    if (toSlot < 0) throw new Error(`Template node ${to} (${b.type}) has no input "${toSlotName}"`);
    if (!a.outputs[fromSlot]) throw new Error(`Template node ${from} (${a.type}) has no output ${fromSlot}`);
    a.outputs[fromSlot].links.push(id);
    b.inputs[toSlot].link = id;
    outLinks.push([id, from, fromSlot, to, toSlot, type]);
  });
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: outLinks.length,
    nodes: outNodes,
    links: outLinks,
    groups: [],
    config: {},
    extra: { comfyMobile: true },
    version: 0.4,
  };
}
