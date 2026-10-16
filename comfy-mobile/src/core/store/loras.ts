/**
 * LoRA Lab extension point: per-file ratings/notes/trigger words, persisted
 * locally. The file list itself comes from the server (`/models/loras`).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LoraMeta {
  rating: number; // 0-5
  notes?: string;
  triggerWords: string[];
  favourite?: boolean;
}

interface LorasState {
  meta: Record<string, LoraMeta>;
  setMeta: (file: string, patch: Partial<LoraMeta>) => void;
}

export const useLorasStore = create<LorasState>()(
  persist(
    (set) => ({
      meta: {},
      setMeta: (file, patch) =>
        set((s) => {
          const current: LoraMeta = s.meta[file] ?? { rating: 0, triggerWords: [] };
          return { meta: { ...s.meta, [file]: { ...current, ...patch } } };
        }),
    }),
    { name: 'comfy-mobile.loras', version: 1 },
  ),
);
