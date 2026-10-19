/**
 * My Studio content store.
 *
 * Holds the content bundle exported from Brad's Video Studio, where it came
 * from (tailnet URL or a picked file), and the derived LoRA index. The bundle
 * itself is cached in IndexedDB (`idb.ts`); only the small settings live in
 * localStorage. The only network peer is the user-configured source URL.
 *
 * Side effect: Brad's LoRA ratings / trigger words are mirrored into
 * `useLorasStore` for files that exist on the connected server, so the
 * existing LoRA picker shows them with no changes of its own. Local edits
 * made in the picker are never overwritten (a per-file fingerprint of what we
 * last synced is kept; we only re-sync entries that are still untouched).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useLorasStore, type LoraMeta } from '../store/loras';
import { useServerStore } from '../store/server';
import { cacheDelete, cacheGet, cacheSet } from './idb';
import { ContentBundleError, DEFAULT_CONTENT_SOURCE_URL, bundleIsEmpty, normaliseBundle, type ContentBundle } from './schema';
import { buildLoraIndex, emptyLoraIndex, loraKey, type LoraIndex } from './triggers';

const CACHE_KEY = 'bundle';

export type ContentStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface ContentState {
  /** Where to fetch bundle.json from (Mac mini over Tailscale by default). */
  sourceUrl: string;
  /** When the current bundle was loaded (ms) and how. */
  loadedAt: number | null;
  origin: 'url' | 'file' | null;
  /** file → fingerprint of the LoraMeta we wrote, so local edits are respected. */
  synced: Record<string, string>;

  bundle: ContentBundle | null;
  loraIndex: LoraIndex;
  hydrated: boolean;
  status: ContentStatus;
  error: string | null;

  setSourceUrl: (url: string) => void;
  /** Loads the cached bundle from IndexedDB (call once at boot). */
  hydrate: () => Promise<void>;
  /** Fetches `sourceUrl` and replaces the bundle. */
  refresh: () => Promise<boolean>;
  /** Accepts bundle JSON text (file picker / paste). */
  importText: (text: string, label?: string) => Promise<boolean>;
  importFile: (file: Blob & { name?: string }) => Promise<boolean>;
  /** Forgets the bundle (cache included). Settings stay. */
  clear: () => Promise<void>;
  /** Mirrors bundle LoRA cards into the local LoRA meta store for files the server has. */
  syncLoraMeta: () => void;
}

export function normalizeContentUrl(input: string): string {
  let u = input.trim();
  if (!u) return DEFAULT_CONTENT_SOURCE_URL;
  if (!/^[a-z]+:\/\//i.test(u)) u = `http://${u}`;
  if (!/\.json(\?|#|$)/i.test(u)) u = `${u.replace(/\/+$/, '')}/bundle.json`;
  return u;
}

function describeFetchError(err: unknown, url: string): string {
  if (err instanceof ContentBundleError) return err.message;
  if (err instanceof TypeError) {
    const pageHttps = typeof location !== 'undefined' && location.protocol === 'https:';
    if (pageHttps && url.startsWith('http://')) return `Blocked: this page is https and ${url} is http (mixed content).`;
    return `Could not reach ${url}. On the Mac run: python3 tools/export_video_studio.py --serve`;
  }
  return (err as Error)?.message ?? String(err);
}

const fingerprint = (m: Pick<LoraMeta, 'rating' | 'triggerWords' | 'notes' | 'favourite'>) =>
  JSON.stringify([m.rating, m.triggerWords, m.notes ?? '', m.favourite ?? false]);

export const useContentStore = create<ContentState>()(
  persist(
    (set, get) => ({
      sourceUrl: DEFAULT_CONTENT_SOURCE_URL,
      loadedAt: null,
      origin: null,
      synced: {},
      bundle: null,
      loraIndex: emptyLoraIndex(),
      hydrated: false,
      status: 'idle',
      error: null,

      setSourceUrl: (url) => set({ sourceUrl: normalizeContentUrl(url) }),

      hydrate: async () => {
        if (get().hydrated) return;
        try {
          const cached = await cacheGet<unknown>(CACHE_KEY);
          if (cached) {
            const bundle = normaliseBundle(cached);
            set({ bundle, loraIndex: buildLoraIndex(bundle), status: 'ok' });
          }
        } catch {
          // A corrupt cache is not fatal: the user can fetch again.
        } finally {
          set({ hydrated: true });
          get().syncLoraMeta();
        }
      },

      refresh: async () => {
        const url = get().sourceUrl;
        set({ status: 'loading', error: null });
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
          const json: unknown = await res.json();
          const bundle = normaliseBundle(json);
          await applyBundle(bundle, 'url');
          return true;
        } catch (err) {
          set({ status: get().bundle ? 'ok' : 'error', error: describeFetchError(err, url) });
          return false;
        }
      },

      importText: async (text) => {
        set({ status: 'loading', error: null });
        try {
          const bundle = normaliseBundle(text);
          if (bundleIsEmpty(bundle)) throw new ContentBundleError('That bundle has no content sections in it.');
          await applyBundle(bundle, 'file');
          return true;
        } catch (err) {
          set({ status: get().bundle ? 'ok' : 'error', error: describeFetchError(err, '') });
          return false;
        }
      },

      importFile: async (file) => get().importText(await file.text()),

      clear: async () => {
        await cacheDelete(CACHE_KEY);
        set({ bundle: null, loraIndex: emptyLoraIndex(), loadedAt: null, origin: null, status: 'idle', error: null });
      },

      syncLoraMeta: () => {
        const { loraIndex, synced } = get();
        const serverFiles = useServerStore.getState().modelLists.loras;
        if (!serverFiles || !loraIndex.size) return;
        const lorasStore = useLorasStore.getState();
        const nextSynced = { ...synced };
        let changed = false;
        for (const file of serverFiles) {
          const entry = loraIndex.byKey[loraKey(file)];
          if (!entry) continue;
          const current = lorasStore.meta[file];
          const previously = synced[file];
          const untouched = !current || (previously !== undefined && fingerprint(current) === previously);
          if (!untouched) continue;
          const patch: LoraMeta = {
            rating: entry.rating ?? current?.rating ?? 0,
            triggerWords: entry.triggerWords,
            notes: entry.card?.notes ?? current?.notes,
            favourite: entry.card?.favourite ?? current?.favourite,
          };
          const fp = fingerprint(patch);
          if (current && fingerprint(current) === fp) continue;
          lorasStore.setMeta(file, patch);
          nextSynced[file] = fp;
          changed = true;
        }
        if (changed) set({ synced: nextSynced });
      },
    }),
    {
      name: 'comfy-mobile.content',
      version: 1,
      partialize: (s) => ({ sourceUrl: s.sourceUrl, loadedAt: s.loadedAt, origin: s.origin, synced: s.synced }),
    },
  ),
);

async function applyBundle(bundle: ContentBundle, origin: 'url' | 'file') {
  await cacheSet(CACHE_KEY, bundle);
  useContentStore.setState({ bundle, loraIndex: buildLoraIndex(bundle), loadedAt: Date.now(), origin, status: 'ok', error: null });
  useContentStore.getState().syncLoraMeta();
}

// Re-run the LoRA meta sync whenever the server's LoRA list (re)loads.
useServerStore.subscribe((s, prev) => {
  if (s.modelLists.loras !== prev.modelLists.loras) useContentStore.getState().syncLoraMeta();
});
