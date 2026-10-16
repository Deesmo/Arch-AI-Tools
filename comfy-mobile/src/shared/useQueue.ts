/**
 * Queues a workflow: builds the API prompt, submits it, applies
 * "control after generate" to seeds, and surfaces errors as toasts.
 * Shared by Graph mode ("Queue Prompt"), Studio ("Generate") and
 * Workflows ("Run").
 */
import { useCallback } from 'react';
import { graphToPrompt, useGraphStore, useServerStore, type Workflow } from '../core';
import { useUiStore } from './ui';

export function useQueue() {
  const queuePrompt = useServerStore((s) => s.queuePrompt);
  const status = useServerStore((s) => s.status);
  const toast = useUiStore((s) => s.toast);

  const queueWorkflow = useCallback(
    async (workflow: Workflow, meta: { source: 'studio' | 'graph'; templateId?: string }) => {
      if (status !== 'connected') {
        toast('Not connected to a ComfyUI server', 'error');
        return null;
      }
      const { prompt } = graphToPrompt(workflow);
      if (Object.keys(prompt).length === 0) {
        toast('Nothing to queue — the graph has no executable nodes', 'error');
        return null;
      }
      const res = await queuePrompt(prompt, workflow, meta);
      if (!res.ok) {
        toast(res.message, 'error');
        return null;
      }
      toast('Queued', 'success');
      return res.promptId;
    },
    [queuePrompt, status, toast],
  );

  /** Queue the graph currently open in Graph mode. */
  const queueCurrentGraph = useCallback(async () => {
    const g = useGraphStore.getState();
    const id = await queueWorkflow(g.workflow, { source: 'graph', templateId: g.templateId ?? undefined });
    if (id) g.applyControls();
    return id;
  }, [queueWorkflow]);

  return { queueWorkflow, queueCurrentGraph };
}
