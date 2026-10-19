/** UI-only state: active tab, toasts, confirm dialogs, media viewer. */
import { create } from 'zustand';
import type { MediaItem } from '../core';

export type Tab = 'studio' | 'mystudio' | 'graph' | 'library' | 'queue' | 'gallery' | 'settings';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiState {
  tab: Tab;
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  viewer: { items: MediaItem[]; index: number } | null;
  workflowsOpen: boolean;
  /** First-run walkthrough / Settings → "How this works". */
  guideOpen: boolean;
  /** Prompt id to show on the live queue list after a successful Run. */
  queueFocusId: string | null;
  setTab: (tab: Tab) => void;
  /** Open the Queue tab on the live list, with this prompt id visible. */
  focusQueuedRun: (promptId: string) => void;
  setGuideOpen: (open: boolean) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  ask: (req: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
  openViewer: (items: MediaItem[], index?: number) => void;
  closeViewer: () => void;
  setWorkflowsOpen: (open: boolean) => void;
}

let toastId = 0;

export const useUiStore = create<UiState>()((set, get) => ({
  tab: 'studio',
  queueFocusId: null,
  toasts: [],
  confirm: null,
  viewer: null,
  workflowsOpen: false,
  guideOpen: false,
  setTab: (tab) => set({ tab }),
  focusQueuedRun: (promptId) => set({ tab: 'queue', queueFocusId: promptId }),
  setGuideOpen: (guideOpen) => set({ guideOpen }),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 5000 : 2800);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  ask: (req) =>
    new Promise<boolean>((resolve) => {
      set({ confirm: { ...req, resolve } });
    }),
  resolveConfirm: (ok) => {
    const c = get().confirm;
    set({ confirm: null });
    c?.resolve(ok);
  },
  openViewer: (items, index = 0) => set({ viewer: { items, index } }),
  closeViewer: () => set({ viewer: null }),
  setWorkflowsOpen: (workflowsOpen) => set({ workflowsOpen }),
}));
