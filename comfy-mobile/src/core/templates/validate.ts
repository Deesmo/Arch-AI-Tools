/**
 * Template validation: diffs the node types and model files a template needs
 * against what the connected server reports (`/object_info`, `/models/<folder>`).
 * Nothing fails silently — the result lists exactly what is missing so Studio
 * can show it and Graph mode can highlight the nodes.
 */
import type { ObjectInfo } from '../api/types';
import { templateAvailability } from './engine';
import type { StudioTemplate } from './schema';

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

export function validateTemplate(
  template: StudioTemplate,
  info: ObjectInfo | null,
  modelLists: Record<string, string[]>,
): TemplateValidation {
  const avail = templateAvailability(template, info);
  const missingModels: { folder: string; file: string }[] = [];
  const unchecked = new Set<string>();
  for (const m of template.models ?? []) {
    const list = modelLists[m.folder];
    if (!list) {
      unchecked.add(m.folder);
      continue;
    }
    if (!list.includes(m.file)) missingModels.push(m);
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
