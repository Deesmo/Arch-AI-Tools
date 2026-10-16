/**
 * Actions that move My Studio content into the rest of the app:
 *   copy card  → appended to the Studio prompt
 *   recipe     → local Recipe (trigger words + author settings + LoRA) made active
 *   LoRA card  → written into a LoRA slot of the current template
 *   preset     → mapped onto the current template's params
 *   workflow   → Graph mode / saved workflows / queued directly
 * Everything here goes through existing stores; nothing talks to the network
 * except queueing on the already-configured ComfyUI server.
 */
import { useCallback, useMemo } from 'react';
import {
  allTemplates,
  api,
  defaultValues,
  getTemplate,
  joinPrompt,
  loraKey,
  loraSlotsFor,
  mapSettingsToTemplate,
  matchServerLoras,
  parseWorkflow,
  prettyName,
  useContentStore,
  useGraphStore,
  useRecipesStore,
  useServerStore,
  useStudioStore,
  useWorkflowsStore,
  type ApiPrompt,
  type BundledWorkflow,
  type ContentPreset,
  type CopyCard,
  type LoraSlot,
  type RecipeLora,
  type StudioRecipe,
  type StudioTemplate,
} from '../../core';
import { useQueue } from '../../shared/useQueue';
import { useUiStore } from '../../shared/ui';

function currentTemplate(): StudioTemplate {
  return getTemplate(useStudioStore.getState().templateId) ?? allTemplates()[0];
}

export function useMyStudio() {
  const toast = useUiStore((s) => s.toast);
  const setTab = useUiStore((s) => s.setTab);
  const loraIndex = useContentStore((s) => s.loraIndex);
  const serverLoras = useServerStore((s) => s.modelLists.loras);
  const connected = useServerStore((s) => s.status === 'connected');
  const templateId = useStudioStore((s) => s.templateId);
  const { queueWorkflow } = useQueue();

  const template = useMemo(() => getTemplate(templateId) ?? allTemplates()[0], [templateId]);
  const slots = useMemo(() => loraSlotsFor(template), [template]);
  const serverMatch = useMemo(() => matchServerLoras(loraIndex, serverLoras), [loraIndex, serverLoras]);

  /** Server-side relative path for a bundle LoRA file, or null when the server has no such file. */
  const serverFileFor = useCallback((file: string): string | null => serverMatch.keyToServerFile[loraKey(file)] ?? null, [serverMatch]);

  const promptParamOf = (t: StudioTemplate) => t.params.find((p) => p.role === 'positive_prompt');

  const currentPrompt = useCallback((t: StudioTemplate): string => {
    const p = promptParamOf(t);
    if (!p) return '';
    const stored = useStudioStore.getState().values[t.id]?.[p.key];
    if (stored !== undefined) return String(stored ?? '');
    const { objectInfo, modelLists } = useServerStore.getState();
    return String(defaultValues(t, objectInfo, modelLists)[p.key] ?? '');
  }, []);

  const setPrompt = useCallback(
    (text: string, mode: 'append' | 'replace') => {
      const t = currentTemplate();
      const p = promptParamOf(t);
      if (!p) {
        toast(`${t.name} has no prompt field`, 'error');
        return false;
      }
      const next = mode === 'replace' ? text.trim() : joinPrompt(currentPrompt(t), text);
      useStudioStore.getState().setValue(t.id, p.key, next);
      return true;
    },
    [currentPrompt, toast],
  );

  // ---- copy cards ---------------------------------------------------------
  const insertCopy = useCallback(
    (card: CopyCard, mode: 'append' | 'replace' = 'append') => {
      if (!setPrompt(card.text, mode)) return;
      if (card.negative) {
        const t = currentTemplate();
        const neg = t.params.find((p) => p.role === 'negative_prompt');
        if (neg) {
          const cur = String(useStudioStore.getState().values[t.id]?.[neg.key] ?? '');
          useStudioStore.getState().setValue(t.id, neg.key, mode === 'replace' ? card.negative : joinPrompt(cur, card.negative));
        }
      }
      toast(mode === 'replace' ? 'Prompt replaced' : 'Added to prompt', 'success');
      setTab('studio');
    },
    [setPrompt, toast, setTab],
  );

  // ---- recipes ------------------------------------------------------------
  const useRecipe = useCallback(
    (recipe: StudioRecipe) => {
      const t = currentTemplate();
      const mapping = mapSettingsToTemplate(t, recipe.settings);
      const values = { ...mapping.values };
      const loras: RecipeLora[] = [];
      const missing: string[] = [];
      const freeSlots = [...slots];
      for (const l of recipe.loras) {
        const serverFile = serverFileFor(l.file);
        if (!serverFile) {
          missing.push(l.file);
          continue;
        }
        const slot = freeSlots.shift();
        if (slot) {
          values[slot.param.key] = serverFile;
          if (slot.toggleKey) values[slot.toggleKey] = true;
        }
        loras.push({ file: serverFile, strength: l.strength ?? Number(recipe.settings.strength ?? 1), triggerWords: l.triggerWords });
      }
      const store = useRecipesStore.getState();
      const marker = `my-studio:${recipe.source}`;
      const existing = store.items.find((r) => r.templateId === t.id && r.notes?.includes(marker));
      const saved = store.save({
        id: existing?.id,
        name: recipe.name,
        templateId: t.id,
        values,
        triggerWords: recipe.triggerWords,
        loras,
        notes: `${recipe.notes ? `${recipe.notes}\n` : ''}${marker}`,
      });
      store.setActive(saved.id);
      // Recipe values sit under the user's own edits, so push them into the form explicitly.
      const studio = useStudioStore.getState();
      for (const [k, v] of Object.entries(values)) studio.setValue(t.id, k, v);

      const parts = [`“${recipe.name}” is now the active recipe for ${t.name}`];
      if (recipe.triggerWords.length) parts.push(`trigger words added at generate time: ${recipe.triggerWords.join(', ')}`);
      if (mapping.applied.length) parts.push(`${mapping.applied.length} author settings applied`);
      if (recipe.loras.length && !slots.length) parts.push('this template has no LoRA slot');
      if (missing.length) parts.push(`not on server: ${missing.map(prettyName).join(', ')}`);
      toast(parts.join(' · '), missing.length && !loras.length && recipe.loras.length ? 'error' : 'success');
      setTab('studio');
    },
    [slots, serverFileFor, toast, setTab],
  );

  // ---- LoRA cards ---------------------------------------------------------
  /** Returns 'choose' when the template has several slots and none was given. */
  const pickLora = useCallback(
    (file: string, slot?: LoraSlot): 'done' | 'choose' | 'failed' => {
      const t = currentTemplate();
      if (!slots.length) {
        toast(`${t.name} has no LoRA slot. Pick a Wan / LTX template in Studio first.`, 'error');
        return 'failed';
      }
      const serverFile = serverFileFor(file);
      if (!serverFile) {
        toast(serverLoras ? `“${prettyName(file)}” is not in models/loras on this server` : 'LoRA list not loaded yet — connect to the server first', 'error');
        return 'failed';
      }
      if (!slot && slots.length > 1) return 'choose';
      const target = slot ?? slots[0];
      const studio = useStudioStore.getState();
      studio.setValue(t.id, target.param.key, serverFile);
      if (target.toggleKey) studio.setValue(t.id, target.toggleKey, true);
      toast(`${prettyName(file)} → ${target.param.label}`, 'success');
      setTab('studio');
      return 'done';
    },
    [slots, serverFileFor, serverLoras, toast, setTab],
  );

  // ---- presets ------------------------------------------------------------
  const applyPreset = useCallback(
    (preset: ContentPreset, withPrompt: boolean) => {
      const t = currentTemplate();
      const mapping = mapSettingsToTemplate(t, preset.values);
      const studio = useStudioStore.getState();
      for (const a of mapping.applied) studio.setValue(t.id, a.param, a.value);
      if (withPrompt && preset.prompt) setPrompt(preset.prompt, 'replace');
      if (preset.negativePrompt) {
        const neg = t.params.find((p) => p.role === 'negative_prompt');
        if (neg) studio.setValue(t.id, neg.key, preset.negativePrompt);
      }
      const msg = mapping.applied.length
        ? `Applied ${mapping.applied.map((a) => a.param).join(', ')} to ${t.name}${mapping.ignored.length ? ` · skipped ${mapping.ignored.join(', ')}` : ''}`
        : `Nothing in “${preset.name}” maps onto ${t.name}${mapping.ignored.length ? ` (${mapping.ignored.join(', ')})` : ''}`;
      toast(msg, mapping.applied.length ? 'success' : 'error');
      if (mapping.applied.length || withPrompt) setTab('studio');
    },
    [setPrompt, toast, setTab],
  );

  // ---- workflows ----------------------------------------------------------
  const openWorkflow = useCallback(
    (w: BundledWorkflow) => {
      if (w.format !== 'ui') {
        toast('This is an API-format prompt — it can be run, but not opened in Graph mode.', 'error');
        return;
      }
      try {
        useGraphStore.getState().loadJson(w.workflow, w.name);
        setTab('graph');
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    },
    [toast, setTab],
  );

  const saveWorkflow = useCallback(
    (w: BundledWorkflow) => {
      if (w.format !== 'ui') {
        toast('Only UI-format workflows can be saved to the device list.', 'error');
        return;
      }
      useWorkflowsStore.getState().save(w.name, w.workflow);
      toast('Saved to this device (Graph → Workflows)', 'success');
    },
    [toast],
  );

  const runWorkflow = useCallback(
    async (w: BundledWorkflow) => {
      if (!connected) {
        toast('Not connected to a ComfyUI server', 'error');
        return;
      }
      try {
        if (w.format === 'ui') {
          const wf = parseWorkflow(w.workflow, useServerStore.getState().objectInfo);
          const id = await queueWorkflow(wf, { source: 'graph' });
          if (id) setTab('queue');
          return;
        }
        if (w.format === 'api') {
          const server = useServerStore.getState();
          await api.queuePrompt(w.workflow as ApiPrompt, server.clientId);
          void server.refreshQueue();
          toast('Queued (API prompt, as exported)', 'success');
          setTab('queue');
          return;
        }
        toast('Unknown workflow format', 'error');
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    },
    [connected, queueWorkflow, toast, setTab],
  );

  return { template, slots, serverLoras, serverMatch, serverFileFor, connected, insertCopy, setPrompt, useRecipe, pickLora, applyPreset, openWorkflow, saveWorkflow, runWorkflow };
}

export type MyStudioActions = ReturnType<typeof useMyStudio>;
