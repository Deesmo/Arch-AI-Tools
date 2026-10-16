/**
 * Studio view-model: current template, parameter values (persisted), live
 * validation against the server, and the generate pipeline
 * (template + values + recipe -> workflow -> prompt -> queue).
 *
 * The Video Studio UX layers on top of this hook; it does not touch the
 * ComfyUI API directly.
 */
import { useCallback, useEffect, useMemo } from 'react';
import {
  allTemplates,
  applyTemplate,
  bindTriggerWords,
  defaultValues,
  getTemplate,
  missingReferenceInputs,
  modelFoldersFor,
  readTemplateValues,
  useGraphStore,
  useRecipesStore,
  useServerStore,
  useStudioStore,
  validateTemplate,
  type StudioTemplate,
  type TemplateValues,
  type Workflow,
} from '../core';
import { useQueue } from '../shared/useQueue';
import { useUiStore } from '../shared/ui';

export function useStudio() {
  const templateId = useStudioStore((s) => s.templateId);
  const storedValues = useStudioStore((s) => s.values[s.templateId]);
  const seedMode = useStudioStore((s) => s.seedMode[s.templateId] ?? 'randomize');
  const { selectTemplate, setValue, setValues, setSeedMode, resetTemplate } = useStudioStore();
  const info = useServerStore((s) => s.objectInfo);
  const modelLists = useServerStore((s) => s.modelLists);
  const uploadedInputs = useServerStore((s) => s.uploadedInputs);
  const refreshModels = useServerStore((s) => s.refreshModels);
  const status = useServerStore((s) => s.status);
  const activeRecipeId = useRecipesStore((s) => s.activeId);
  const recipe = useRecipesStore((s) => s.items.find((r) => r.id === s.activeId) ?? null);
  const { queueWorkflow } = useQueue();
  const toast = useUiStore((s) => s.toast);

  const template: StudioTemplate = useMemo(() => getTemplate(templateId) ?? allTemplates()[0], [templateId]);

  // Prefetch model lists for validation once connected.
  useEffect(() => {
    if (status !== 'connected') return;
    for (const folder of modelFoldersFor(allTemplates())) {
      if (!modelLists[folder]) void refreshModels(folder);
    }
    if (!modelLists.loras) void refreshModels('loras');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const defaults = useMemo(() => defaultValues(template, info, modelLists), [template, info, modelLists]);
  const values: TemplateValues = useMemo(
    () => ({ ...defaults, ...(recipe && recipe.templateId === template.id ? recipe.values : {}), ...(storedValues ?? {}) }),
    [defaults, storedValues, recipe, template.id],
  );

  const validation = useMemo(() => validateTemplate(template, info, modelLists, values), [template, info, modelLists, values]);
  /** Reference image/video params that still need an upload (the server has no such file). */
  const missingInputs = useMemo(() => missingReferenceInputs(template, values, info, uploadedInputs), [template, values, info, uploadedInputs]);

  const set = useCallback((key: string, value: unknown) => setValue(template.id, key, value), [setValue, template.id]);

  /** Final positive prompt after recipe trigger words. */
  const finalPrompt = useMemo(() => {
    const p = template.params.find((x) => x.role === 'positive_prompt');
    const text = p ? String(values[p.key] ?? '') : '';
    return bindTriggerWords(text, recipe && recipe.templateId === template.id ? recipe : null);
  }, [template, values, recipe]);

  /** Builds the workflow that would be queued right now. */
  const buildWorkflow = useCallback((): Workflow => {
    const merged: TemplateValues = { ...values };
    const p = template.params.find((x) => x.role === 'positive_prompt');
    if (p) merged[p.key] = finalPrompt;
    return applyTemplate(template, merged, info);
  }, [template, values, finalPrompt, info]);

  const randomiseSeed = useCallback(() => {
    for (const p of template.params) {
      if (p.type === 'seed') set(p.key, Math.floor(Math.random() * 1_000_000_000_000));
    }
  }, [template, set]);

  const generate = useCallback(async () => {
    if (validation.missingNodes.length) {
      toast(`Missing nodes on server: ${validation.missingNodes.join(', ')}`, 'error');
      return null;
    }
    if (missingInputs.length) {
      toast(`Upload a ${missingInputs[0].param.type} for “${missingInputs[0].param.label}” first`, 'error');
      return null;
    }
    const wf = buildWorkflow();
    const id = await queueWorkflow(wf, { source: 'studio', templateId: template.id });
    if (id && seedMode === 'randomize') randomiseSeed();
    return id;
  }, [validation, missingInputs, buildWorkflow, queueWorkflow, template.id, seedMode, randomiseSeed, toast]);

  /** Open the current configuration in Graph mode. */
  const openInGraph = useCallback(() => {
    useGraphStore.getState().load(buildWorkflow(), { name: template.name, templateId: template.id });
  }, [buildWorkflow, template]);

  /** Pull values back from the graph currently open in Graph mode (if it came from this template). */
  const syncFromGraph = useCallback(() => {
    const g = useGraphStore.getState();
    if (g.templateId !== template.id) return false;
    setValues(template.id, { ...storedValues, ...readTemplateValues(template, g.workflow) });
    return true;
  }, [template, storedValues, setValues]);

  return {
    template,
    templates: allTemplates(),
    values,
    set,
    reset: () => resetTemplate(template.id),
    selectTemplate,
    seedMode,
    setSeedMode: (m: 'randomize' | 'fixed') => setSeedMode(template.id, m),
    validation,
    missingInputs,
    recipe: recipe && recipe.templateId === template.id ? recipe : null,
    activeRecipeId,
    finalPrompt,
    buildWorkflow,
    generate,
    openInGraph,
    syncFromGraph,
    randomiseSeed,
    connected: status === 'connected',
  };
}

export type StudioModel = ReturnType<typeof useStudio>;
