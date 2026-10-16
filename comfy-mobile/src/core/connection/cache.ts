/**
 * On-device cache for the two server payloads that are slow to fetch over a
 * phone link: `/object_info` (tens of MB on a server with many custom node
 * packs) and the `/models/<folder>` lists. Stored in IndexedDB — localStorage
 * is far too small and synchronous.
 *
 * Keyed by **server URL + ComfyUI version**: a different server, or the same
 * server after an upgrade, never sees another's node list. Custom-node packs
 * can change without the version changing, so a cache hit is always followed
 * by a background refresh; the cache only makes the *first* paint instant.
 *
 * Every function is a no-op (returns null / resolves) when IndexedDB is not
 * available (Node tests, private-mode quirks), so callers never need to guard.
 */
import type { ObjectInfo } from '../api/types';

const DB_NAME = 'comfy-mobile.cache';
const DB_VERSION = 1;
const STORE_OBJECT_INFO = 'objectInfo';
const STORE_MODELS = 'models';

export interface CachedObjectInfo {
  key: string;
  serverUrl: string;
  version: string;
  savedAt: number;
  objectInfo: ObjectInfo;
}

export interface CachedModels {
  key: string;
  serverUrl: string;
  version: string;
  savedAt: number;
  lists: Record<string, string[]>;
}

export function cacheKey(serverUrl: string, version: string | undefined | null): string {
  return `${serverUrl}|${version ?? 'unknown'}`;
}

function idb(): IDBFactory | null {
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  const factory = idb();
  if (!factory) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OBJECT_INFO)) db.createObjectStore(STORE_OBJECT_INFO, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_MODELS)) db.createObjectStore(STORE_MODELS, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab upgrades the schema, drop our handle so the next call reopens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function get<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(store, 'readonly');
    const value = await promisify(tx.objectStore(store).get(key));
    return (value as T | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Writes `value` and removes other versions cached for the same server URL,
 * so an upgraded server does not leave a stale multi-MB blob behind.
 */
async function putReplacingServer<T extends { key: string; serverUrl: string }>(store: string, value: T): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const keys = (await promisify(os.getAllKeys())) as string[];
    for (const k of keys) {
      if (k !== value.key && k.startsWith(`${value.serverUrl}|`)) os.delete(k);
    }
    os.put(value);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } catch {
    // Quota exceeded / private mode: the cache is an optimisation, never fatal.
  }
}

export const nodeListCache = {
  async getObjectInfo(serverUrl: string, version: string | undefined | null): Promise<CachedObjectInfo | null> {
    const hit = await get<CachedObjectInfo>(STORE_OBJECT_INFO, cacheKey(serverUrl, version));
    return hit && hit.objectInfo && typeof hit.objectInfo === 'object' ? hit : null;
  },

  putObjectInfo(serverUrl: string, version: string | undefined | null, objectInfo: ObjectInfo): Promise<void> {
    return putReplacingServer(STORE_OBJECT_INFO, {
      key: cacheKey(serverUrl, version),
      serverUrl,
      version: version ?? 'unknown',
      savedAt: Date.now(),
      objectInfo,
    } satisfies CachedObjectInfo);
  },

  async getModels(serverUrl: string, version: string | undefined | null): Promise<CachedModels | null> {
    const hit = await get<CachedModels>(STORE_MODELS, cacheKey(serverUrl, version));
    return hit && hit.lists && typeof hit.lists === 'object' ? hit : null;
  },

  putModels(serverUrl: string, version: string | undefined | null, lists: Record<string, string[]>): Promise<void> {
    return putReplacingServer(STORE_MODELS, {
      key: cacheKey(serverUrl, version),
      serverUrl,
      version: version ?? 'unknown',
      savedAt: Date.now(),
      lists,
    } satisfies CachedModels);
  },

  /** Drops everything (Settings → Clear local data). */
  async clear(): Promise<void> {
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction([STORE_OBJECT_INFO, STORE_MODELS], 'readwrite');
      tx.objectStore(STORE_OBJECT_INFO).clear();
      tx.objectStore(STORE_MODELS).clear();
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } catch {
      /* ignore */
    }
  },
};
