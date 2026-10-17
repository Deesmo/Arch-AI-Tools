/**
 * Permanent delete of one of this app's ComfyUI outputs, with a confirm step.
 *
 * ComfyUI core exposes exactly one delete that touches outputs:
 * `POST /history {"delete": [prompt_id]}`, which removes the whole run (all
 * of its outputs) from the server's history — so the pictures leave the
 * Gallery here and in ComfyUI's own history on every device. There is no
 * core route that unlinks the file itself; the confirm text says so instead
 * of pretending otherwise. Nothing is hidden client-side.
 */
import { useCallback } from 'react';
import { mediaFromHistoryEntry, useServerStore, type MediaItem } from '../core';
import { useUiStore } from './ui';

export function deleteOutputMessage(outputs: number, runNumber: number | undefined): string {
  const run = runNumber !== undefined ? `run #${runNumber}` : 'this run';
  const scope = outputs > 1 ? `This removes ${run} and all ${outputs} of its outputs` : `This removes ${run} and its output`;
  return `${scope} from ComfyUI's history on the server, so it disappears from the Gallery on every device. There is no undo. ComfyUI has no API that deletes the file itself, so the bytes stay in the server's output folder until it is cleaned up there.`;
}

/** Returns `confirmAndDelete(item)`: asks first, then deletes the run; resolves true when it is gone. */
export function useDeleteOutput() {
  const ask = useUiStore((s) => s.ask);
  const toast = useUiStore((s) => s.toast);
  const deleteRun = useServerStore((s) => s.deleteRun);

  return useCallback(
    async (item: MediaItem): Promise<boolean> => {
      if (!item.promptId) {
        toast('This output is not in the server history, so there is nothing to delete.', 'error');
        return false;
      }
      const entry = useServerStore.getState().history?.[item.promptId];
      const outputs = entry ? mediaFromHistoryEntry(item.promptId, entry).filter((m) => m.ref.type !== 'temp').length : 1;
      const ok = await ask({
        title: outputs > 1 ? `Delete ${item.ref.filename} and ${outputs - 1} more?` : `Delete ${item.ref.filename}?`,
        message: deleteOutputMessage(outputs, entry?.prompt?.[0]),
        confirmLabel: 'Delete forever',
        danger: true,
      });
      if (!ok) return false;
      const res = await deleteRun(item.promptId);
      if (!res.ok) {
        toast(`Not deleted — ${res.error}`, 'error');
        return false;
      }
      toast(outputs > 1 ? `Deleted ${outputs} outputs` : 'Deleted', 'success');
      return true;
    },
    [ask, toast, deleteRun],
  );
}
