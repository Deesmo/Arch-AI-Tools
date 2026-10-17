/**
 * Queues a workflow: builds the API prompt, submits it, applies
 * "control after generate" to seeds, and surfaces errors as toasts.
 * Shared by Graph mode ("Queue Prompt"), Studio ("Generate") and
 * Workflows ("Run").
 */
import { useCallback } from 'react';
import { emptyWorkflow, graphToPrompt, unexpandedMessage, useGraphStore, useServerStore, type ApiPrompt, type Workflow } from '../core';
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
      const { prompt, unexpanded } = graphToPrompt(workflow);
      if (unexpanded.length > 0) {
        // Never post a graph with an unexpanded subgraph: the server would
        // reject it with a bare node id (KeyError('117')) instead of a name.
        toast(unexpandedMessage(unexpanded), 'error');
        return null;
      }
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

  /**
   * Posts an API prompt as given. Same `/prompt` call as `queueWorkflow`.
   * Does not rebuild nodes or inputs — a UI-graph conversion drops fields
   * ComfyUI still requires, such as timeline_data and builder_state.
   * `message` is "Queued" or the server's error text.
   */
  const queueApiPrompt = useCallback(
    async (
      prompt: ApiPrompt,
      meta: { source: 'studio' | 'graph'; templateId?: string },
    ): Promise<{ ok: boolean; promptId: string | null; message: string }> => {
      if (status !== 'connected') {
        const message = 'Not connected to a ComfyUI server';
        toast(message, 'error');
        return { ok: false, promptId: null, message };
      }
      if (Object.keys(prompt).length === 0) {
        const message = 'Nothing to queue — the graph has no executable nodes';
        toast(message, 'error');
        return { ok: false, promptId: null, message };
      }
      const res = await queuePrompt(prompt, emptyWorkflow(), meta);
      if (!res.ok) {
        toast(res.message, 'error');
        return { ok: false, promptId: null, message: res.message };
      }
      toast('Queued', 'success');
      return { ok: true, promptId: res.promptId, message: 'Queued' };
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

  return { queueWorkflow, queueCurrentGraph, queueApiPrompt };
}
