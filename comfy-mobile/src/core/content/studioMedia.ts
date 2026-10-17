/**
 * Video Studio thumbnail store — LoRA / workflow / copy card previews read
 * live from Video Studio on the Mac (port 8140; see `videoStudio.ts`). No
 * proxy, no bridge, and none of Video Studio's own image/video libraries.
 *
 * Persisted on the device (localStorage): the Video Studio URL and the PIN
 * Brad typed. The PIN is sent only to `POST /pin`, never logged, never
 * written anywhere else, and the bundle never sees it. The `vs_pin` cookie
 * that unlocks the rest is held by the browser (`credentials: 'include'`).
 * When a request comes back "pin required" (cookie expired, Video Studio
 * restarted) the stored PIN is replayed once; if that fails the UI shows the
 * PIN field.
 *
 * Card media is a few small JSON documents, fetched together and cached in
 * IndexedDB so thumbnails are there on the next launch before the network
 * answers.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cacheDelete, cacheGet, cacheSet } from './idb';
import {
  DEFAULT_VIDEO_STUDIO_URL,
  VideoStudioError,
  buildCardMedia,
  describeStudioError,
  emptyCardMedia,
  fetchStudioJson,
  normalizeVideoStudioUrl,
  studioErrorKind,
  unlockStudio,
  type StudioCardMedia,
  type StudioErrorKind,
} from './videoStudio';

const CARDS_CACHE_KEY = 'vs-cards';

export type StudioStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface StudioMediaState {
  baseUrl: string;
  /** Device-only. Replayed to `POST /pin` when the cookie dies. */
  pin: string | null;
  /** True after a request was refused for want of a PIN and the stored one (if any) did not help. */
  locked: boolean;
  unlockError: string | null;
  unlocking: boolean;

  cards: StudioCardMedia;
  cardsStatus: StudioStatus;
  cardsError: string | null;
  cardsErrorKind: StudioErrorKind | null;
  cardsLoadedAt: number | null;
  hydrated: boolean;

  setBaseUrl: (url: string) => void;
  /** Stores the PIN on the device and unlocks Video Studio with it. */
  unlock: (pin: string) => Promise<boolean>;
  /** Forgets the PIN (nothing is sent anywhere; the browser cookie expires on its own). */
  forgetPin: () => void;
  hydrate: () => Promise<void>;
  /** Loads LoRA / workflow / copy previews. */
  loadCards: (force?: boolean) => Promise<boolean>;
}

let unlockInFlight: Promise<boolean> | null = null;

export const useStudioMediaStore = create<StudioMediaState>()(
  persist(
    (set, get) => {
      /**
       * Runs a Video Studio request; on "pin required" replays the stored PIN
       * once and retries. Marks the store locked when that is not possible.
       */
      const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
        try {
          const out = await run();
          if (get().locked) set({ locked: false, unlockError: null });
          return out;
        } catch (err) {
          if (!(err instanceof VideoStudioError) || err.kind !== 'pin') throw err;
          const pin = get().pin;
          if (pin && (await relock(pin))) return run();
          set({ locked: true });
          throw err;
        }
      };

      const relock = async (pin: string): Promise<boolean> => {
        if (!unlockInFlight) {
          unlockInFlight = (async () => {
            set({ unlocking: true });
            try {
              await unlockStudio(get().baseUrl, pin);
              set({ locked: false, unlockError: null });
              return true;
            } catch (err) {
              set({ locked: true, unlockError: describeStudioError(err, get().baseUrl) });
              return false;
            } finally {
              set({ unlocking: false });
              unlockInFlight = null;
            }
          })();
        }
        return unlockInFlight;
      };

      return {
        baseUrl: DEFAULT_VIDEO_STUDIO_URL,
        pin: null,
        locked: false,
        unlockError: null,
        unlocking: false,
        cards: emptyCardMedia(),
        cardsStatus: 'idle',
        cardsError: null,
        cardsErrorKind: null,
        cardsLoadedAt: null,
        hydrated: false,

        setBaseUrl: (url) => {
          const next = normalizeVideoStudioUrl(url);
          if (next === get().baseUrl) return;
          set({ baseUrl: next, locked: false, unlockError: null, cardsStatus: 'idle', cardsError: null, cardsErrorKind: null });
        },

        unlock: async (pin) => {
          const trimmed = pin.trim();
          if (!trimmed) return false;
          set({ pin: trimmed });
          const ok = await relock(trimmed);
          if (ok) void get().loadCards(true);
          return ok;
        },

        forgetPin: () => set({ pin: null, locked: false, unlockError: null }),

        hydrate: async () => {
          if (get().hydrated) return;
          try {
            const cached = await cacheGet<{ cards: StudioCardMedia; at: number; baseUrl: string }>(CARDS_CACHE_KEY);
            if (cached?.cards && cached.baseUrl === get().baseUrl) set({ cards: cached.cards, cardsLoadedAt: cached.at, cardsStatus: 'ok' });
          } catch {
            /* a bad cache is not fatal */
          } finally {
            set({ hydrated: true });
          }
        },

        loadCards: async (force = false) => {
          const { cardsStatus, cardsLoadedAt, baseUrl } = get();
          if (cardsStatus === 'loading') return false;
          if (!force && cardsStatus === 'ok' && cardsLoadedAt && Date.now() - cardsLoadedAt < 5 * 60_000) return true;
          set({ cardsStatus: 'loading', cardsError: null, cardsErrorKind: null });
          const get1 = (path: string) => guarded(() => fetchStudioJson(baseUrl, path));
          const results = await Promise.allSettled([get1('/api/guide-data'), get1('/config/lora_cards.json'), get1('/api/workflows/cards'), get1('/api/copies/cards')]);
          const value = (i: number) => (results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<unknown>).value : undefined);
          const failures = results.map((r, i) => (r.status === 'rejected' ? { i, err: r.reason as unknown } : null)).filter((x): x is { i: number; err: unknown } => !!x);
          // lora_cards.json is optional (guide-data alone may carry every preview); only count the others.
          const hard = failures.filter((f) => f.i !== 1 || (f.err instanceof VideoStudioError && f.err.kind === 'pin'));
          if (hard.length === results.length - 1 || hard.some((f) => f.err instanceof VideoStudioError && f.err.kind === 'pin')) {
            const first = hard[0]?.err ?? failures[0]?.err;
            set({ cardsStatus: get().cardsLoadedAt ? 'ok' : 'error', cardsError: describeStudioError(first, baseUrl), cardsErrorKind: studioErrorKind(first) });
            return false;
          }
          const cards = buildCardMedia({ guideData: value(0), loraCards: value(1), workflowCards: value(2), copyCards: value(3) });
          const at = Date.now();
          set({ cards, cardsStatus: 'ok', cardsLoadedAt: at, cardsError: hard.length ? describeStudioError(hard[0].err, baseUrl) : null, cardsErrorKind: hard.length ? studioErrorKind(hard[0].err) : null });
          void cacheSet(CARDS_CACHE_KEY, { cards, at, baseUrl });
          return true;
        },
      };
    },
    {
      name: 'comfy-mobile.video-studio',
      version: 2,
      // v1 persisted a proxy URL (…:8152/vs) and a proxy session token; neither exists any more.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<Pick<StudioMediaState, 'baseUrl' | 'pin'>>;
        const baseUrl = typeof p.baseUrl === 'string' && !/:8152(\/|$)/.test(p.baseUrl) ? p.baseUrl : DEFAULT_VIDEO_STUDIO_URL;
        return { baseUrl, pin: typeof p.pin === 'string' ? p.pin : null } as StudioMediaState;
      },
      partialize: (s) => ({ baseUrl: s.baseUrl, pin: s.pin }),
    },
  ),
);

/** Forgets the cached card media (used by "Forget cached bundle"). */
export async function clearStudioMediaCache(): Promise<void> {
  await cacheDelete(CARDS_CACHE_KEY);
  useStudioMediaStore.setState({ cards: emptyCardMedia(), cardsLoadedAt: null, cardsStatus: 'idle' });
}
