/**
 * Template validation: diffs the node types and model files a template needs
 * against what the connected server reports (`/object_info`, `/models/<folder>`).
 * Nothing fails silently — the result lists exactly what is missing so Studio
 * can show it and Graph mode can highlight the nodes.
 */
import type { ObjectInfo } from '../api/types';
import { bakedValues, paramOptions, templateAvailability } from './engine';
import type { StudioTemplate, TemplateParam, TemplateValues } from './schema';

export interface TemplateValidation {
  templateId: string;
  /** Node types referenced by the template but absent from object_info. */
  missingNodes: string[];
  /** Model files referenced by the template but absent from the server's model lists. */
  missingModels: { folder: string; file: string }[];
  /** Model folders we could not check (list not loaded). */
  uncheckedFolders: string[];
  /** True when object_info is not loaded (nothing could be checked). */
  unknown: boolean;
  /** Runnable: no missing nodes. Missing models are a warning (filenames can be changed). */
  ok: boolean;
}

/**
 * `values` (current Studio values) makes the model check reflect what will
 * actually be queued: a baked file that a model param has since been pointed
 * elsewhere (user choice or `defaultValues` server fallback) is judged by the
 * param's current value, not the template's original filename.
 */
export function validateTemplate(
  template: StudioTemplate,
  info: ObjectInfo | null,
  modelLists: Record<string, string[]>,
  values?: TemplateValues,
): TemplateValidation {
  const avail = templateAvailability(template, info);
  const missingModels: { folder: string; file: string }[] = [];
  const unchecked = new Set<string>();
  const baked = values ? bakedValues(template, info) : {};
  const effectiveFile = (file: string): string => {
    if (!values) return file;
    const p = template.params.find((x) => x.role === 'model' && baked[x.key] === file);
    const current = p ? values[p.key] : undefined;
    return typeof current === 'string' && current ? current : file;
  };
  for (const m of template.models ?? []) {
    const list = modelLists[m.folder];
    if (!list) {
      unchecked.add(m.folder);
      continue;
    }
    const file = effectiveFile(m.file);
    if (!list.includes(file)) missingModels.push({ folder: m.folder, file });
  }
  return {
    templateId: template.id,
    missingNodes: avail.missing,
    missingModels,
    uncheckedFolders: [...unchecked],
    unknown: avail.unknown,
    ok: !avail.unknown && avail.missing.length === 0,
  };
}

export interface MissingReferenceInput {
  param: TemplateParam;
  /** Current value; empty string when nothing has been chosen yet. */
  value: string;
}

/**
 * Reference media params (`image` / `video`) whose current value is not a
 * file the server has. The server's LoadImage/LoadVideo combo lists its input
 * folder at connect time; `uploadedInputs` covers files uploaded since. An
 * empty value always counts as missing. Returns [] until object_info is loaded
 * (nothing can be checked yet), so callers gate only on a known-missing file.
 */
export function missingReferenceInputs(
  template: StudioTemplate,
  values: TemplateValues,
  info: ObjectInfo | null,
  uploadedInputs: readonly string[] = [],
): MissingReferenceInput[] {
  if (!info) return [];
  const out: MissingReferenceInput[] = [];
  for (const param of template.params) {
    if (param.type !== 'image' && param.type !== 'video') continue;
    const value = String(values[param.key] ?? param.default ?? '');
    if (value && (uploadedInputs.includes(value) || paramOptions(param, template, info).includes(value))) continue;
    out.push({ param, value });
  }
  return out;
}

/** Distinct model folders referenced by a set of templates (to prefetch lists). */
export function modelFoldersFor(templates: StudioTemplate[]): string[] {
  const folders = new Set<string>();
  for (const t of templates) for (const m of t.models ?? []) folders.add(m.folder);
  return [...folders];
}

/** Human-readable one-liner for a validation result. */
export function describeValidation(v: TemplateValidation): string {
  if (v.unknown) return 'Connect to a server to check availability';
  const parts: string[] = [];
  if (v.missingNodes.length) parts.push(`${v.missingNodes.length} missing node type${v.missingNodes.length > 1 ? 's' : ''}`);
  if (v.missingModels.length) parts.push(`${v.missingModels.length} model file${v.missingModels.length > 1 ? 's' : ''} not found`);
  return parts.length ? parts.join(' · ') : 'Ready';
}
