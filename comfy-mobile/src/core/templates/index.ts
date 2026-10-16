/**
 * Template registry. Add a new bundled template by exporting it from
 * `bundled/*.ts` and listing it here. User templates (plain JSON matching
 * `StudioTemplate`) can be registered at runtime with `registerTemplate`.
 */
import { imageTemplates } from './bundled/image';
import { videoTemplates } from './bundled/video';
import type { StudioTemplate } from './schema';

export * from './schema';
export * from './engine';
export * from './validate';
export * from './loras';
export { buildWorkflow } from './builder';

const registry = new Map<string, StudioTemplate>();
for (const t of [...videoTemplates, ...imageTemplates]) registry.set(t.id, t);

export function allTemplates(): StudioTemplate[] {
  return [...registry.values()];
}

export function getTemplate(id: string): StudioTemplate | undefined {
  return registry.get(id);
}

export function registerTemplate(t: StudioTemplate) {
  registry.set(t.id, t);
}

/** Validates a parsed JSON object as a StudioTemplate (loose structural check). */
export function parseTemplateJson(raw: unknown): StudioTemplate {
  if (!raw || typeof raw !== 'object') throw new Error('Template must be an object');
  const t = raw as Partial<StudioTemplate>;
  if (!t.id || !t.name || !t.workflow || !Array.isArray(t.params)) {
    throw new Error('Template needs id, name, params[] and workflow');
  }
  for (const p of t.params) {
    if (!p.key || !p.type || !Array.isArray(p.bindings)) throw new Error(`Param "${p.key ?? '?'}" needs key, type, bindings[]`);
  }
  return {
    description: '',
    kind: 'txt2video',
    engine: 'Custom',
    requires: [],
    ...t,
  } as StudioTemplate;
}
