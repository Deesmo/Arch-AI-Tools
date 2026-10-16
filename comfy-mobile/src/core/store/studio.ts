/**
 * Studio layer state: selected template + parameter values per template.
 * Persisted so a user's last prompt/settings survive restarts.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TemplateValues } from '../templates/schema';

interface StudioState {
  templateId: string;
  values: Record<string, TemplateValues>;
  /** Whether to randomise seeds after each generate (per template). */
  seedMode: Record<string, 'randomize' | 'fixed'>;
  selectTemplate: (id: string) => void;
  setValue: (templateId: string, key: string, value: unknown) => void;
  setValues: (templateId: string, values: TemplateValues) => void;
  setSeedMode: (templateId: string, mode: 'randomize' | 'fixed') => void;
  resetTemplate: (templateId: string) => void;
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set) => ({
      templateId: 'wan22-txt2video',
      values: {},
      seedMode: {},
      selectTemplate: (templateId) => set({ templateId }),
      setValue: (templateId, key, value) =>
        set((s) => ({ values: { ...s.values, [templateId]: { ...(s.values[templateId] ?? {}), [key]: value } } })),
      setValues: (templateId, values) => set((s) => ({ values: { ...s.values, [templateId]: values } })),
      setSeedMode: (templateId, mode) => set((s) => ({ seedMode: { ...s.seedMode, [templateId]: mode } })),
      resetTemplate: (templateId) =>
        set((s) => {
          const values = { ...s.values };
          delete values[templateId];
          return { values };
        }),
    }),
    { name: 'comfy-mobile.studio', version: 1 },
  ),
);
