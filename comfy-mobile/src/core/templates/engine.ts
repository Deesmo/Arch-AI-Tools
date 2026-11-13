/**
 * Template engine: resolves bindings, reads/writes parameter values on a
 * workflow, and reports availability against the server's object_info.
 */
import type { ObjectInfo } from '../api/types';
import { getWidgetValue, setWidgetValue, updateNode } from '../graph/model';
import { parseWorkflow } from '../graph/serialize';
import { NODE_MODE_ALWAYS, NODE_MODE_BYPASS, type GraphNode, type Workflow } from '../graph/types';
import { comboValues, isComboSpec, orderedInputs } from '../graph/widgets';
import type { Binding, NodeRef, StudioTemplate, TemplateParam, TemplateValues } from './schema';

export function findNode(wf: Workflow, ref: NodeRef): GraphNode | undefined {
  if ('id' in ref) return wf.nodes.find((n) => n.id === ref.id);
  if ('title' in ref) return wf.nodes.find((n) => (n.title ?? '') === ref.title);
  const matches = wf.nodes.filter((n) => n.type === ref.type);
  return matches[ref.index ?? 0];
}

function transformValue(value: unknown, binding: Binding, values: TemplateValues): unknown {
  switch (binding.transform) {
    case 'seconds_to_frames': {
      const fps = Number(values.fps ?? 16);
      return Math.max(1, Math.round(Number(value) * fps));
    }
    case 'frames_plus_one':
      return Number(value) + 1;
    case 'half':
      return Math.max(1, Math.round(Number(value) / 2));
    default:
      return value;
  }
}

/** Instantiates the template workflow with the given parameter values. */
export function applyTemplate(
  template: StudioTemplate,
  values: TemplateValues,
  info: ObjectInfo | null,
): Workflow {
  let wf = parseWorkflow(template.workflow, info);
  for (const param of template.params) {
    const raw = values[param.key] ?? param.default;
    if (raw === undefined) continue;
    for (const b of param.bindings) {
      const node = findNode(wf, b.node);
      if (!node) continue;
      if (b.target === 'mode') {
        wf = updateNode(wf, node.id, { mode: raw ? NODE_MODE_ALWAYS : NODE_MODE_BYPASS });
      } else {
        wf = setWidgetValue(wf, node.id, b.widget, transformValue(raw, b, values), info);
      }
    }
  }
  return wf;
}

/** Inverse of `transformValue`, so transformed bindings round-trip from a workflow. */
function untransformValue(value: unknown, binding: Binding, values: TemplateValues): unknown {
  switch (binding.transform) {
    case 'seconds_to_frames': {
      const fps = Number(values.fps ?? 16);
      return Number(value) / Math.max(1, fps);
    }
    case 'frames_plus_one':
      return Number(value) - 1;
    case 'half':
      return Number(value) * 2;
    default:
      return value;
  }
}

/** Reads one param back from the workflow: the first readable binding wins, untransformed bindings preferred. */
function readParam(param: TemplateParam, wf: Workflow, values: TemplateValues): unknown {
  const ordered = [...param.bindings].sort((a, b) => Number(!!a.transform) - Number(!!b.transform));
  for (const b of ordered) {
    const node = findNode(wf, b.node);
    if (!node) continue;
    if (b.target === 'mode') return node.mode !== NODE_MODE_BYPASS;
    const v = getWidgetValue(node, b.widget);
    if (v === undefined) continue;
    return b.transform ? untransformValue(v, b, values) : v;
  }
  return undefined;
}

/**
 * Reads current values back from a workflow (used when returning from Graph
 * mode and for "Reuse settings"). Params whose only bindings are transformed
 * (e.g. duration in seconds -> frames) are inverted; `fps` is read first so
 * `seconds_to_frames` can be undone.
 */
export function readTemplateValues(template: StudioTemplate, wf: Workflow): TemplateValues {
  const values: TemplateValues = {};
  const params = [...template.params].sort((a, b) => Number(a.key !== 'fps') - Number(b.key !== 'fps'));
  for (const param of params) {
    const v = readParam(param, wf, values);
    if (v !== undefined) values[param.key] = v;
  }
  return values;
}

export interface Availability {
  available: boolean;
  /** Node types missing from object_info. Empty when `available`. */
  missing: string[];
  /** True when object_info has not been loaded yet (unknown availability). */
  unknown: boolean;
}

export function templateAvailability(template: StudioTemplate, info: ObjectInfo | null): Availability {
  if (!info) return { available: false, missing: [], unknown: true };
  const required = new Set<string>(template.requires);
  // Also require every node type used by the workflow itself.
  const nodes = (template.workflow as { nodes?: { type: string }[] })?.nodes ?? [];
  for (const n of nodes) {
    if (!['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode'].includes(n.type)) required.add(n.type);
  }
  const missing = [...required].filter((t) => !info[t]);
  return { available: missing.length === 0, missing, unknown: false };
}

/** Combo options for a param: explicit list, else from object_info for the bound widget. */
export function paramOptions(param: TemplateParam, template: StudioTemplate, info: ObjectInfo | null): string[] {
  if (param.options?.length) return param.options;
  const b = param.bindings[0];
  if (!b || !info) return [];
  const nodes = (template.workflow as { nodes?: { id: number; type: string; title?: string }[] })?.nodes ?? [];
  let type: string | undefined;
  if ('id' in b.node) type = nodes.find((n) => n.id === (b.node as { id: number }).id)?.type;
  else if ('title' in b.node) type = nodes.find((n) => n.title === (b.node as { title: string }).title)?.type;
  else type = (b.node as { type: string }).type;
  const def = type ? info[type] : undefined;
  if (!def) return [];
  const input = orderedInputs(def).find((i) => i.name === b.widget);
  if (!input || !isComboSpec(input.spec)) return [];
  return comboValues(input.spec);
}

/** Values baked into the template workflow for each param (before any server-aware substitution). */
export function bakedValues(template: StudioTemplate, info: ObjectInfo | null): TemplateValues {
  const wf = parseWorkflow(template.workflow, info);
  const values: TemplateValues = {};
  for (const p of template.params) {
    if (p.default !== undefined) {
      values[p.key] = p.default;
      continue;
    }
    const b = p.bindings[0];
    const node = b ? findNode(wf, b.node) : undefined;
    if (!node || !b) continue;
    if (b.target === 'mode') {
      values[p.key] = node.mode !== NODE_MODE_BYPASS;
      continue;
    }
    const v = getWidgetValue(node, b.widget);
    if (v !== undefined) values[p.key] = v;
  }
  return values;
}

/** Folder a model param's baked file lives in, per the template's `models` list. */
export function modelFolderFor(template: StudioTemplate, file: unknown): string | undefined {
  return (template.models ?? []).find((m) => m.file === file)?.folder;
}

/**
 * Picks the file a model param should default to on this server: the baked
 * file when the server has it, otherwise the first entry of the matching
 * `/models/<folder>` list (or of the widget's combo). Returns undefined when
 * nothing on the server can be checked yet.
 */
export function serverModelDefault(
  param: TemplateParam,
  template: StudioTemplate,
  baked: unknown,
  info: ObjectInfo | null,
  modelLists: Record<string, string[]>,
): string | undefined {
  if (!info) return undefined;
  const options = paramOptions(param, template, info);
  const folder = modelFolderFor(template, baked);
  const onDisk = folder ? modelLists[folder] : undefined;
  const known = onDisk ?? options;
  if (known.length === 0) return undefined;
  if (known.includes(String(baked))) return undefined;
  return (onDisk ?? options)[0];
}

/**
 * Default values for all params: template defaults, falling back to the
 * workflow's widget values. Model params (`role: "model"`) whose baked file is
 * not on the connected server default to the first file the server does have,
 * so e.g. the SD1.5 image templates pick a real checkpoint instead of a
 * `v1-5-pruned-emaonly.safetensors` that was never installed.
 */
export function defaultValues(template: StudioTemplate, info: ObjectInfo | null, modelLists: Record<string, string[]> = {}): TemplateValues {
  const values = bakedValues(template, info);
  for (const p of template.params) {
    if (p.role !== 'model' || p.type !== 'combo' || values[p.key] === undefined) continue;
    const fallback = serverModelDefault(p, template, values[p.key], info, modelLists);
    if (fallback !== undefined) values[p.key] = fallback;
  }
  return values;
}
