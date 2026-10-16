/**
 * The things a Library item can do: land in Studio (set a param / add to the
 * LoRA stack / append an embedding token), be added to the graph as a loader
 * node, open a server-saved workflow in Graph mode, or run it straight away.
 * Shared by the Library action sheets; nothing here writes to the server
 * except "Run" (POST /prompt), same as the Graph "Queue Prompt" button.
 */
import { useCallback } from 'react';
import {
  allTemplates,
  applyTemplate,
  defaultValues,
  getTemplate,
  loaderFor,
  parseWorkflow,
  studioTargetFor,
  supportsStudioLoras,
  useGraphStore,
  useLibraryStore,
  useServerStore,
  useStudioStore,
  type StudioTarget,
  type StudioTemplate,
  type UserWorkflow,
} from '../core';
import { useQueue } from '../shared/useQueue';
import { useUiStore } from '../shared/ui';

function currentTemplate(): StudioTemplate {
  return getTemplate(useStudioStore.getState().templateId) ?? allTemplates()[0];
}

/** Centre of the visible canvas in graph coordinates (where "Open in Graph" drops the node). */
function canvasCentre(): [number, number] {
  const vp = useGraphStore.getState().viewport;
  const rect = document.querySelector('.canvas-root')?.getBoundingClientRect();
  const w = rect?.width ?? window.innerWidth;
  const h = rect?.height ?? window.innerHeight;
  return [(w / 2 - vp.x) / vp.scale - 100, (h / 2 - vp.y) / vp.scale - 60];
}

export function useLibraryActions() {
  const info = useServerStore((s) => s.objectInfo);
  const modelLists = useServerStore((s) => s.modelLists);
  const setTab = useUiStore((s) => s.setTab);
  const toast = useUiStore((s) => s.toast);
  const { queueWorkflow } = useQueue();
  const fetchWorkflow = useLibraryStore((s) => s.fetchWorkflow);

  /** What "Use in Studio" would do right now for this file (for labelling the button). */
  const studioTarget = useCallback(
    (folder: string, file: string): StudioTarget => {
      const t = currentTemplate();
      const stackSupported = supportsStudioLoras(t.kind, applyTemplate(t, defaultValues(t, info, modelLists), info), info);
      return studioTargetFor(t, folder, file, info, modelLists, { stackSupported });
    },
    [info, modelLists],
  );

  const useInStudio = useCallback(
    (folder: string, file: string): boolean => {
      const t = currentTemplate();
      const target = studioTarget(folder, file);
      const studio = useStudioStore.getState();
      switch (target.kind) {
        case 'stack': {
          const added = studio.addLora(t.id, file);
          if (!added) {
            const already = (studio.loras[t.id] ?? []).some((l) => l.file === file);
            toast(already ? 'Already in the LoRA stack' : 'LoRA stack is full (4) — remove one in Studio first', 'error');
            return false;
          }
          toast(`Added to “${t.name}” LoRAs`, 'success');
          break;
        }
        case 'param':
          studio.setValue(t.id, target.key, file);
          toast(`${target.label} set for “${t.name}”`, 'success');
          break;
        case 'prompt': {
          const p = t.params.find((x) => x.role === 'positive_prompt');
          if (!p) {
            toast('This template has no prompt box', 'error');
            return false;
          }
          const current = String(studio.values[t.id]?.[p.key] ?? defaultValues(t, info, modelLists)[p.key] ?? '');
          if (!current.includes(target.token)) studio.setValue(t.id, p.key, current ? `${current}, ${target.token}` : target.token);
          toast(`Added ${target.token} to the prompt`, 'success');
          break;
        }
        case 'none':
          toast(target.reason, 'error');
          return false;
      }
      setTab('studio');
      return true;
    },
    [studioTarget, info, modelLists, setTab, toast],
  );

  /** Adds the right loader node (with the file selected) to the graph currently open in Graph mode. */
  const openInGraph = useCallback(
    (folder: string, file: string): boolean => {
      const loader = loaderFor(folder, file, info);
      if (!loader) {
        toast(folder === 'embeddings' ? 'Embeddings go in the prompt text, not a node' : `No node on this server loads files from “${folder}”`, 'error');
        return false;
      }
      const g = useGraphStore.getState();
      const node = g.addNode(loader.type, canvasCentre());
      if (!node) {
        toast(`Could not add ${loader.type}`, 'error');
        return false;
      }
      g.setWidget(node.id, loader.widget, file);
      g.select(node.id);
      setTab('graph');
      toast(`Added ${loader.type}`, 'success');
      return true;
    },
    [info, setTab, toast],
  );

  /** Downloads a server-saved workflow and opens it in Graph mode. */
  const openWorkflow = useCallback(
    async (w: UserWorkflow): Promise<boolean> => {
      try {
        const raw = await fetchWorkflow(w);
        useGraphStore.getState().load(parseWorkflow(raw, info), { name: w.name.split('/').pop() ?? w.name, savedId: null, templateId: null });
        setTab('graph');
        return true;
      } catch (err) {
        toast((err as Error).message, 'error');
        return false;
      }
    },
    [fetchWorkflow, info, setTab, toast],
  );

  /** Downloads a server-saved workflow and queues it as-is. */
  const runWorkflow = useCallback(
    async (w: UserWorkflow): Promise<string | null> => {
      try {
        const wf = parseWorkflow(await fetchWorkflow(w), info);
        const id = await queueWorkflow(wf, { source: 'graph' });
        if (id) setTab('queue');
        return id;
      } catch (err) {
        toast((err as Error).message, 'error');
        return null;
      }
    },
    [fetchWorkflow, info, queueWorkflow, setTab, toast],
  );

  /** Uses an input image as the reference of the current template, or of the primary image→video template. */
  const useAsReference = useCallback(
    (file: string): boolean => {
      const studio = useStudioStore.getState();
      let t = currentTemplate();
      let p = t.params.find((x) => x.role === 'reference_image');
      if (!p) {
        const alt = allTemplates().find((x) => x.params.some((y) => y.role === 'reference_image') && x.tags?.includes('primary')) ?? allTemplates().find((x) => x.params.some((y) => y.role === 'reference_image'));
        if (!alt) {
          toast('No template takes a reference image', 'error');
          return false;
        }
        t = alt;
        p = t.params.find((x) => x.role === 'reference_image')!;
        studio.selectTemplate(t.id);
      }
      studio.setValue(t.id, p.key, file);
      setTab('studio');
      toast(`Reference set for “${t.name}”`, 'success');
      return true;
    },
    [setTab, toast],
  );

  return { studioTarget, useInStudio, openInGraph, openWorkflow, runWorkflow, useAsReference };
}
