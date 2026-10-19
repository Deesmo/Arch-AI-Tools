/**
 * Tiny IndexedDB key/value helper for the content bundle cache (bundles can
 * exceed localStorage's ~5 MB budget). Falls back to localStorage when
 * IndexedDB is unavailable (private mode, tests under Node).
 */
const DB_NAME = 'comfy-mobile-content';
const STORE = 'kv';
const LS_PREFIX = 'comfy-mobile.content.cache.';

function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
        t.oncomplete = () => db.close();
        t.onabort = () => {
          db.close();
          reject(t.error ?? new Error('IndexedDB transaction aborted'));
        };
      }),
  );
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  if (hasIdb()) {
    try {
      return (await tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>)) ?? undefined;
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  if (hasIdb()) {
    try {
      await tx('readwrite', (s) => s.put(value, key));
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded — the in-memory copy still works for this session.
  }
}

export async function cacheDelete(key: string): Promise<void> {
  if (hasIdb()) {
    try {
      await tx('readwrite', (s) => s.delete(key));
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* ignore */
  }
}
