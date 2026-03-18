/**
 * Analytics Middleware — Tracks API call metrics + Usage Alerts
 *
 * Records response time, status code, and enriches existing ApiRequest/X402Payment
 * logging with timing data. Uses Redis for real-time counters when available,
 * falls back to in-memory with periodic flush.
 *
 * Usage Alerts System:
 * - Tracks rate limit violations per agent (3+ hits → flag for outreach)
 * - Tracks credit usage thresholds (80% used → low-credit warning)
 * - Detects unusual traffic patterns (10x normal volume)
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
export interface UsageAlert {
    id: string;
    type: "rate_limit_repeat" | "low_credits" | "traffic_spike";
    agentId: string;
    message: string;
    severity: "warning" | "critical";
    timestamp: number;
    acknowledged: boolean;
    metadata: Record<string, unknown>;
}
export declare function analyticsMiddleware(req: Request, res: Response, next: NextFunction): void;
/**
 * Check if an agent is near their credit limit.
 * Called externally (e.g., from credit deduction logic).
 */
export declare function checkCreditThreshold(agentId: string, creditsRemaining: number, totalCredits: number): void;
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
export declare function getActiveAlerts(limit?: number): UsageAlert[];
export declare function getAllAlerts(limit?: number): UsageAlert[];
export declare function acknowledgeAlert(alertId: string): boolean;
export declare function getAlertStats(): {
    total: number;
    unacknowledged: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
};
export declare function getRateLimitViolators(): Array<{
    agentId: string;
    hits: number;
}>;
export declare const SERVER_START_TIME: number;
export declare function getStatusPageData(): {
    uptime_seconds: number;
    avg_response_ms: number;
    p50_response_ms: number;
    p95_response_ms: number;
    p99_response_ms: number;
    total_calls_24h: number;
    unique_agents_24h: number;
    error_rate_24h: number;
    active_endpoints: number;
};
export {};
//# sourceMappingURL=analytics.d.ts.map