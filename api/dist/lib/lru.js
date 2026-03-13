import { LRUCache } from "lru-cache";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolCache = new LRUCache({
    max: 500,
    ttl: 1000 * 60 * 10, // 10 minutes
});
export function getCached(key) {
    return toolCache.get(key);
}
export function setCached(key, value) {
    toolCache.set(key, value);
}
//# sourceMappingURL=lru.js.map