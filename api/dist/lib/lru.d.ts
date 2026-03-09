import { LRUCache } from "lru-cache";
export declare const toolCache: LRUCache<string, any, unknown>;
export declare function getCached<T>(key: string): T | undefined;
export declare function setCached(key: string, value: unknown): void;
//# sourceMappingURL=lru.d.ts.map