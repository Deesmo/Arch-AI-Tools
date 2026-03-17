/**
 * Agent Reputation Service — Lightweight KYA (Know Your Agent)
 *
 * Calculates reputation scores based on:
 * - Payment history (40% weight) — agents that pay reliably score higher
 * - Usage volume (30% weight) — active agents are more trustworthy
 * - Error rate (30% weight) — low error rates = well-behaved agent
 *
 * Score: 0-100, starts at 50 (neutral)
 * Badge tiers: Bronze (10+), Silver (100+), Gold (1000+), Diamond (10000+)
 */
export declare const BADGE_THRESHOLDS: {
    readonly diamond: 10000;
    readonly gold: 1000;
    readonly silver: 100;
    readonly bronze: 10;
    readonly none: 0;
};
export type Badge = keyof typeof BADGE_THRESHOLDS;
export declare function calculateBadge(totalCalls: number): Badge;
export declare function calculateReputationScore(params: {
    successCount: number;
    errorCount: number;
    totalCalls: number;
    totalSpentUsdc: number;
    accountAgeDays: number;
}): number;
export declare function updateAgentReputation(agentId: string): Promise<void>;
export declare function recordAgentCall(agentId: string, success: boolean): Promise<void>;
export declare function recordAgentSpend(agentId: string, amountUsdc: number): Promise<void>;
//# sourceMappingURL=reputation.d.ts.map