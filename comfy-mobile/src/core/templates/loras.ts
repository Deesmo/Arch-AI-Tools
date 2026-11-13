/**
 * Studio LoRA stack: up to `MAX_STUDIO_LORAS` extra LoRAs the user picks in
 * Studio, applied to a template workflow as a chain of `LoraLoaderModelOnly`
 * nodes inserted right after every model loader (a node with a MODEL output
 * and no MODEL input — UNETLoader, CheckpointLoaderSimple…). Wan 2.2's two
 * loaders therefore each get the full chain, which is how a character/style
 * LoRA is normally applied to both experts.
 *
 * The chain is rebuilt from scratch on every `applyTemplate`, so adding or
 * removing a LoRA in Studio adds/removes the corresponding nodes. Injected
 * nodes carry `properties[STUDIO_LORA_PROP] = true` so `readStudioLoras`
 * can recover the stack when a graph comes back from Graph mode.
 */
import type { ObjectInfo } from '../api/types';
import { connect, createNode, removeNode, setWidgetValue } from '../graph/model';
import type { GraphNode, Workflow } from '../graph/types';

export interface StudioLora {
  file: string;
  /** `strength_model`; 1.0 = as trained. */
  strength: number;
}

export const MAX_STUDIO_LORAS = 4;
export const STUDIO_LORA_PROP = 'comfy-mobile.studioLora';
const LORA_NODE = 'LoraLoaderModelOnly';

/** Clamp a strength the way the LoraLoaderModelOnly widget would (−100…100, 2 decimals). */
export function clampStrength(v: number): number {
  const n = Number.isFinite(v) ? v : 1;
  return Math.round(Math.max(-100, Math.min(100, n)) * 100) / 100;
}

/** Adds a LoRA to the stack (no duplicates, capped at MAX_STUDIO_LORAS). Returns the same array when nothing changed. */
export function addLora(list: StudioLora[], file: string, strength = 1): StudioLora[] {
  if (!file || list.some((l) => l.file === file) || list.length >= MAX_STUDIO_LORAS) return list;
  return [...list, { file, strength: clampStrength(strength) }];
}

export function removeLora(list: StudioLora[], file: string): StudioLora[] {
  const next = list.filter((l) => l.file !== file);
  return next.length === list.length ? list : next;
}

export function setLoraStrength(list: StudioLora[], file: string, strength: number): StudioLora[] {
  return list.map((l) => (l.file === file ? { ...l, strength: clampStrength(strength) } : l));
}

function isModelRoot(n: GraphNode): boolean {
  if (n.properties?.[STUDIO_LORA_PROP]) return false;
  const outputsModel = n.outputs.some((o) => o.type === 'MODEL');
  const takesModel = n.inputs.some((i) => i.type === 'MODEL');
  return outputsModel && !takesModel;
}

/** Nodes the Studio stack will hang off (for the "applies to…" hint). */
export function modelRoots(wf: Workflow): GraphNode[] {
  return wf.nodes.filter(isModelRoot);
}

/** Removes every previously injected Studio LoRA node, reconnecting nothing (callers re-inject). */
export function stripStudioLoras(wf: Workflow): Workflow {
  const injected = wf.nodes.filter((n) => n.properties?.[STUDIO_LORA_PROP]);
  if (!injected.length) return wf;
  let next = wf;
  for (const stale of injected) {
    // Re-read the node: bridging the previous one re-linked this one's input.
    const n = next.nodes.find((x) => x.id === stale.id);
    if (!n) continue;
    // Bridge the node out before removing it so downstream links survive.
    const inLink = n.inputs.find((i) => i.type === 'MODEL')?.link;
    const outSlot = n.outputs.findIndex((o) => o.type === 'MODEL');
    const src = inLink != null ? next.links.find((l) => l[0] === inLink) : undefined;
    const targets = outSlot >= 0 ? next.links.filter((l) => l[1] === n.id && l[2] === outSlot) : [];
    next = removeNode(next, n.id);
    if (src) for (const t of targets) next = connect(next, src[1], src[2], t[3], t[4]);
  }
  return next;
}

/**
 * Applies the Studio LoRA stack to a workflow. Existing Studio LoRA nodes are
 * replaced; template-owned LoRA nodes (e.g. the Lightning loaders) are left
 * alone and end up downstream of the stack, exactly like adding loaders by
 * hand between the model loader and whatever it fed.
 */
export function withStudioLoras(wf: Workflow, loras: StudioLora[], info: ObjectInfo | null): Workflow {
  let next = stripStudioLoras(wf);
  const stack = loras.filter((l) => l.file).slice(0, MAX_STUDIO_LORAS);
  if (!stack.length) return next;
  const roots = modelRoots(next);
  for (const root of roots) {
    const outSlot = root.outputs.findIndex((o) => o.type === 'MODEL');
    const downstream = next.links.filter((l) => l[1] === root.id && l[2] === outSlot).map((l) => [l[3], l[4]] as const);
    let prev: { id: number; slot: number } = { id: root.id, slot: outSlot };
    stack.forEach((lora, i) => {
      const pos: [number, number] = [root.pos[0] + 260 + i * 40, root.pos[1] + 40 * (i + 1)];
      const created = createNode(next, LORA_NODE, pos, info);
      next = created.wf;
      const node = created.node;
      const inSlot = node.inputs.findIndex((s) => s.type === 'MODEL');
      const nodeOut = node.outputs.findIndex((o) => o.type === 'MODEL');
      next = {
        ...next,
        nodes: next.nodes.map((n) =>
          n.id === node.id
            ? {
                ...n,
                title: `LoRA ${i + 1}: ${lora.file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? lora.file}`,
                properties: { ...n.properties, [STUDIO_LORA_PROP]: true },
              }
            : n,
        ),
      };
      next = setWidgetValue(next, node.id, 'lora_name', lora.file, info);
      next = setWidgetValue(next, node.id, 'strength_model', clampStrength(lora.strength), info);
      if (inSlot >= 0) next = connect(next, prev.id, prev.slot, node.id, inSlot);
      prev = { id: node.id, slot: nodeOut >= 0 ? nodeOut : 0 };
    });
    for (const [toNode, toSlot] of downstream) next = connect(next, prev.id, prev.slot, toNode, toSlot);
  }
  return next;
}

/** Reads the Studio LoRA stack back from a workflow (de-duplicated across model roots, chain order kept). */
export function readStudioLoras(wf: Workflow): StudioLora[] {
  const out: StudioLora[] = [];
  const injected = wf.nodes.filter((n) => n.properties?.[STUDIO_LORA_PROP] && n.type === LORA_NODE).sort((a, b) => a.id - b.id);
  for (const n of injected) {
    const widgets = n.widgets ?? [];
    const nameIdx = widgets.findIndex((w) => w.name === 'lora_name');
    const strengthIdx = widgets.findIndex((w) => w.name === 'strength_model');
    const file = String((nameIdx >= 0 ? n.widgets_values[nameIdx] : n.widgets_values[0]) ?? '');
    const strength = Number((strengthIdx >= 0 ? n.widgets_values[strengthIdx] : n.widgets_values[1]) ?? 1);
    if (file && !out.some((l) => l.file === file)) out.push({ file, strength: clampStrength(strength) });
  }
  return out.slice(0, MAX_STUDIO_LORAS);
}

/** True when a template can take the Studio LoRA stack: a video template whose server has LoraLoaderModelOnly and at least one model root. */
export function supportsStudioLoras(kind: string, wf: Workflow, info: ObjectInfo | null): boolean {
  if (!kind.includes('video')) return false;
  if (info && !info[LORA_NODE]) return false;
  return modelRoots(wf).length > 0;
}
