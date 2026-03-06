import { LRUCache } from "lru-cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolCache = new LRUCache<string, any>({
  max: 500,
  ttl: 1000 * 60 * 10, // 10 minutes
});

export function getCached<T>(key: string): T | undefined {
  return toolCache.get(key) as T | undefined;
}

export function setCached(key: string, value: unknown): void {
  toolCache.set(key, value);
}
