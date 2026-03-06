"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolCache = void 0;
exports.getCached = getCached;
exports.setCached = setCached;
const lru_cache_1 = require("lru-cache");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
exports.toolCache = new lru_cache_1.LRUCache({
    max: 500,
    ttl: 1000 * 60 * 10, // 10 minutes
});
function getCached(key) {
    return exports.toolCache.get(key);
}
function setCached(key, value) {
    exports.toolCache.set(key, value);
}
//# sourceMappingURL=lru.js.map