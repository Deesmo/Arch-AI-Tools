/**
 * Analytics Middleware — Tracks API call metrics
 *
 * Records response time, status code, and enriches existing ApiRequest/X402Payment
 * logging with timing data. Uses Redis for real-time counters when available,
 * falls back to in-memory with periodic flush.
 */
import { Request, Response, NextFunction } from "express";
interface MetricEntry {
    endpoint: string;
    toolName: string | null;
    method: string;
    statusCode: number;
    responseMs: number;
    timestamp: number;
    paymentType: "x402" | "credits" | "free" | "admin";
    agentId: string | null;
}
export declare function analyticsMiddleware(req: Request, res: Response, next: NextFunction): void;
export declare function getRecentMetrics(limit?: number): MetricEntry[];
export declare function getMetricsSince(sinceMs: number): MetricEntry[];
export declare function getTotalCallsInMemory(): number;
export declare function getRedisAnalytics(): Promise<{
    totalCalls: number;
    callsToday: number;
    x402CallsTotal: number;
    x402CallsToday: number;
} | null>;
export declare function getToolRedisStats(toolName: string): Promise<{
    totalCalls: number;
    callsToday: number;
    avgResponseMs: number;
} | null>;
export {};
//# sourceMappingURL=analytics.d.ts.map