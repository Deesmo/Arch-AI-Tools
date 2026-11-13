/**
 * Saved workflows (localStorage). Stores exported ComfyUI JSON so entries
 * can be shared with the desktop UI unchanged.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SavedWorkflow {
  id: string;
  name: string;
  /** Exported ComfyUI workflow JSON (object). */
  workflow: Record<string, unknown>;
  templateId?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface WorkflowsState {
  items: SavedWorkflow[];
  save: (name: string, workflow: Record<string, unknown>, id?: string | null, templateId?: string | null) => SavedWorkflow;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => SavedWorkflow | null;
}

function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useWorkflowsStore = create<WorkflowsState>()(
  persist(
    (set, get) => ({
      items: [],
      save: (name, workflow, id, templateId) => {
        const now = Date.now();
        const existing = id ? get().items.find((w) => w.id === id) : undefined;
        const entry: SavedWorkflow = existing
          ? { ...existing, name, workflow, templateId: templateId ?? existing.templateId, updatedAt: now }
          : { id: newId(), name, workflow, templateId: templateId ?? null, createdAt: now, updatedAt: now };
        set((s) => ({
          items: existing ? s.items.map((w) => (w.id === entry.id ? entry : w)) : [entry, ...s.items],
        }));
        return entry;
      },
      rename: (id, name) =>
        set((s) => ({ items: s.items.map((w) => (w.id === id ? { ...w, name, updatedAt: Date.now() } : w)) })),
      remove: (id) => set((s) => ({ items: s.items.filter((w) => w.id !== id) })),
      duplicate: (id) => {
        const src = get().items.find((w) => w.id === id);
        if (!src) return null;
        const copy: SavedWorkflow = {
          ...src,
          id: newId(),
          name: `${src.name} copy`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ items: [copy, ...s.items] }));
        return copy;
      },
    }),
    { name: 'comfy-mobile.workflows', version: 1 },
  ),
);
