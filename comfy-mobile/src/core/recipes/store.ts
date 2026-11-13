import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Recipe } from './schema';

interface RecipesState {
  items: Recipe[];
  /** Recipe currently applied in Studio (null = none). */
  activeId: string | null;
  save: (recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Recipe;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
}

function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useRecipesStore = create<RecipesState>()(
  persist(
    (set, get) => ({
      items: [],
      activeId: null,
      save: (input) => {
        const now = Date.now();
        const existing = input.id ? get().items.find((r) => r.id === input.id) : undefined;
        const recipe: Recipe = existing
          ? { ...existing, ...input, id: existing.id, updatedAt: now }
          : { ...input, id: newId(), createdAt: now, updatedAt: now };
        set((s) => ({
          items: existing ? s.items.map((r) => (r.id === recipe.id ? recipe : r)) : [recipe, ...s.items],
        }));
        return recipe;
      },
      remove: (id) => set((s) => ({ items: s.items.filter((r) => r.id !== id), activeId: s.activeId === id ? null : s.activeId })),
      setActive: (activeId) => set({ activeId }),
    }),
    { name: 'comfy-mobile.recipes', version: 1 },
  ),
);
