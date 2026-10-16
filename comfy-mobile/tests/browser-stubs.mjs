/**
 * Minimal browser globals so core modules (zustand `persist`, `baseUrl()`,
 * connection diagnosis) can be imported under Node. Import this before any
 * app module in a test file; ESM evaluates static imports in order.
 */
const memory = new Map();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => void memory.set(k, String(v)),
    removeItem: (k) => void memory.delete(k),
    clear: () => memory.clear(),
    key: (i) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  },
});

// zustand's persist middleware resolves storage as `window.localStorage`.
if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
}

/** Mutable so tests can simulate an https (device / hosted) page origin. */
export const fakeLocation = { protocol: 'http:', host: 'localhost:5173', origin: 'http://localhost:5173' };
Object.defineProperty(globalThis, 'location', { configurable: true, value: fakeLocation });

export function setPageOrigin(origin) {
  const u = new URL(origin);
  fakeLocation.protocol = u.protocol;
  fakeLocation.host = u.host;
  fakeLocation.origin = u.origin;
}
