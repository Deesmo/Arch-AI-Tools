/**
 * Library state: the server's model folder list and user-saved workflows.
 * File lists per folder live in `useServerStore.modelLists` (shared with the
 * Studio pickers); this store only adds the folder enumeration, the
 * `/api/userdata` workflow index and fetch helpers. Everything is read-only
 * against the server and reset when the server URL changes.
 */
import { create } from 'zustand';
import { ApiError, api } from '../api/client';
import { parseUserdataList, userWorkflowPath, type UserWorkflow } from '../library';
import { useServerStore } from './server';
import { useSettingsStore } from './settings';

interface LibraryState {
  /** `GET /models` result; null until fetched. */
  folders: string[] | null;
  foldersError: string | null;
  loadingFolders: boolean;
  /** `GET /api/userdata?dir=workflows` result; null until fetched. */
  workflows: UserWorkflow[] | null;
  workflowsError: string | null;
  loadingWorkflows: boolean;
  /** Fetches the folder list and every folder's files (in parallel). */
  refreshFolders: () => Promise<void>;
  refreshWorkflows: () => Promise<void>;
  /** Downloads one saved workflow's JSON. */
  fetchWorkflow: (w: UserWorkflow) => Promise<unknown>;
  refreshAll: () => Promise<void>;
  reset: () => void;
}

const initial = {
  folders: null,
  foldersError: null,
  loadingFolders: false,
  workflows: null,
  workflowsError: null,
  loadingWorkflows: false,
};

function message(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${typeof err.body === 'string' && err.body ? err.body : err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  ...initial,

  refreshFolders: async () => {
    if (get().loadingFolders) return;
    set({ loadingFolders: true, foldersError: null });
    try {
      const folders = await api.getModelFolders();
      set({ folders });
      const refresh = useServerStore.getState().refreshModels;
      await Promise.all(folders.map((f) => refresh(f)));
    } catch (err) {
      set({ foldersError: message(err) });
    } finally {
      set({ loadingFolders: false });
    }
  },

  refreshWorkflows: async () => {
    if (get().loadingWorkflows) return;
    set({ loadingWorkflows: true, workflowsError: null });
    try {
      set({ workflows: parseUserdataList(await api.listUserdata('workflows', true)) });
    } catch (err) {
      // 404 = the user never saved a workflow in the ComfyUI web UI; not an error worth showing.
      if (err instanceof ApiError && err.status === 404) set({ workflows: [] });
      else set({ workflowsError: message(err) });
    } finally {
      set({ loadingWorkflows: false });
    }
  },

  fetchWorkflow: (w) => api.getUserdata(userWorkflowPath(w)),

  refreshAll: async () => {
    await Promise.all([get().refreshFolders(), get().refreshWorkflows()]);
  },

  reset: () => set({ ...initial }),
}));

useSettingsStore.subscribe((s, prev) => {
  if (s.serverUrl !== prev.serverUrl) useLibraryStore.getState().reset();
});
