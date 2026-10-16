/**
 * Persisted user settings (localStorage). Shared by Studio and Graph layers.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LinkStyle = 'spline' | 'linear' | 'straight';
export type AppMode = 'studio' | 'graph';

export interface SettingsState {
  /** ComfyUI server base URL. Default = Skytech over Tailscale. */
  serverUrl: string;
  /** Which layer opens on launch. */
  defaultMode: AppMode;
  snapToGrid: boolean;
  showGrid: boolean;
  showNodeIds: boolean;
  linkStyle: LinkStyle;
  confirmDelete: boolean;
  /** Poll /queue & /history when the socket is open (ms). 0 = only on events. */
  pollIntervalMs: number;
  /** Max history items fetched for the gallery. */
  historyLimit: number;
  /** Studio: show the review sheet before queueing. */
  reviewBeforeQueue: boolean;
  /** First-run walkthrough has been dismissed (re-openable from Settings → "How this works"). */
  guideSeen: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
  reset: () => void;
}

export const DEFAULT_SERVER_URL = 'http://100.103.142.118:8188';

const defaults = {
  serverUrl: DEFAULT_SERVER_URL,
  defaultMode: 'studio' as AppMode,
  snapToGrid: true,
  showGrid: true,
  showNodeIds: false,
  linkStyle: 'spline' as LinkStyle,
  confirmDelete: true,
  pollIntervalMs: 0,
  historyLimit: 64,
  reviewBeforeQueue: true,
  guideSeen: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
      reset: () => set({ ...defaults }),
    }),
    { name: 'comfy-mobile.settings', version: 1 },
  ),
);
