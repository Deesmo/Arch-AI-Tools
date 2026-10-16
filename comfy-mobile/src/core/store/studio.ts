/**
 * Studio layer state: selected template + parameter values per template, and
 * the per-template Studio LoRA stack. Persisted so a user's last
 * prompt/settings survive restarts.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { addLora, removeLora, setLoraStrength, type StudioLora } from '../templates/loras';
import type { TemplateValues } from '../templates/schema';

interface StudioState {
  templateId: string;
  values: Record<string, TemplateValues>;
  /** Whether to randomise seeds after each generate (per template). */
  seedMode: Record<string, 'randomize' | 'fixed'>;
  /** Extra LoRAs stacked onto the template's model loaders (per template, max 4). */
  loras: Record<string, StudioLora[]>;
  selectTemplate: (id: string) => void;
  setValue: (templateId: string, key: string, value: unknown) => void;
  setValues: (templateId: string, values: TemplateValues) => void;
  setSeedMode: (templateId: string, mode: 'randomize' | 'fixed') => void;
  resetTemplate: (templateId: string) => void;
  addLora: (templateId: string, file: string, strength?: number) => boolean;
  removeLora: (templateId: string, file: string) => void;
  setLoraStrength: (templateId: string, file: string, strength: number) => void;
  setLoras: (templateId: string, loras: StudioLora[]) => void;
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set, get) => ({
      templateId: 'wan22-txt2video',
      values: {},
      seedMode: {},
      loras: {},
      selectTemplate: (templateId) => set({ templateId }),
      setValue: (templateId, key, value) =>
        set((s) => ({ values: { ...s.values, [templateId]: { ...(s.values[templateId] ?? {}), [key]: value } } })),
      setValues: (templateId, values) => set((s) => ({ values: { ...s.values, [templateId]: values } })),
      setSeedMode: (templateId, mode) => set((s) => ({ seedMode: { ...s.seedMode, [templateId]: mode } })),
      resetTemplate: (templateId) =>
        set((s) => {
          const values = { ...s.values };
          delete values[templateId];
          const loras = { ...s.loras };
          delete loras[templateId];
          return { values, loras };
        }),
      addLora: (templateId, file, strength = 1) => {
        const current = get().loras[templateId] ?? [];
        const next = addLora(current, file, strength);
        if (next === current) return false;
        set((s) => ({ loras: { ...s.loras, [templateId]: next } }));
        return true;
      },
      removeLora: (templateId, file) => set((s) => ({ loras: { ...s.loras, [templateId]: removeLora(s.loras[templateId] ?? [], file) } })),
      setLoraStrength: (templateId, file, strength) =>
        set((s) => ({ loras: { ...s.loras, [templateId]: setLoraStrength(s.loras[templateId] ?? [], file, strength) } })),
      setLoras: (templateId, loras) => set((s) => ({ loras: { ...s.loras, [templateId]: loras } })),
    }),
    { name: 'comfy-mobile.studio', version: 1 },
  ),
);
