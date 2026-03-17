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
import { prisma } from "../lib/prisma.js";
// ─── Badge Thresholds ────────────────────────────────────────────────────────
export const BADGE_THRESHOLDS = {
    diamond: 10000,
    gold: 1000,
    silver: 100,
    bronze: 10,
    none: 0,
};
export function calculateBadge(totalCalls) {
    if (totalCalls >= BADGE_THRESHOLDS.diamond)
        return "diamond";
    if (totalCalls >= BADGE_THRESHOLDS.gold)
        return "gold";
    if (totalCalls >= BADGE_THRESHOLDS.silver)
        return "silver";
    if (totalCalls >= BADGE_THRESHOLDS.bronze)
        return "bronze";
    return "none";
}
// ─── Reputation Score ────────────────────────────────────────────────────────
export function calculateReputationScore(params) {
    const { successCount, errorCount, totalCalls, totalSpentUsdc, accountAgeDays } = params;
    if (totalCalls === 0)
        return 50; // neutral starting score
    // Payment factor (0-1): agents who spend more are more invested
    // Logarithmic scale: $0 = 0, $1 = 0.5, $10 = 0.75, $100 = 1.0
    const paymentFactor = totalSpentUsdc <= 0
        ? 0
        : Math.min(1, Math.log10(totalSpentUsdc + 1) / 2);
    // Usage factor (0-1): active agents are more trustworthy
    // Logarithmic scale: 1 call = 0.1, 100 = 0.5, 10000 = 1.0
    const usageFactor = Math.min(1, Math.log10(totalCalls + 1) / 4);
    // Error rate factor (0-1): lower error rate = higher score
    const errorRate = totalCalls > 0 ? errorCount / totalCalls : 0;
    const errorFactor = Math.max(0, 1 - errorRate * 2); // 50%+ error rate = 0
    // Age bonus (0-0.1): small bonus for longevity
    const ageBonus = Math.min(0.1, accountAgeDays / 365 * 0.1);
    // Weighted combination
    const rawScore = (paymentFactor * 0.4) + (usageFactor * 0.3) + (errorFactor * 0.3) + ageBonus;
    // Scale to 0-100
    return Math.round(Math.min(100, Math.max(0, rawScore * 100)));
}
// ─── Update Agent Reputation ─────────────────────────────────────────────────
// Call this after each API request or payment
export async function updateAgentReputation(agentId) {
    try {
        const agent = await prisma.agent.findUnique({
            where: { id: agentId },
            select: {
                totalCalls: true,
                successCount: true,
                errorCount: true,
                totalSpentUsdc: true,
                createdAt: true,
            },
        });
        if (!agent)
            return;
        const accountAgeDays = Math.floor((Date.now() - agent.createdAt.getTime()) / (1000 * 60 * 60 * 24));
        const reputationScore = calculateReputationScore({
            successCount: agent.successCount,
            errorCount: agent.errorCount,
            totalCalls: agent.totalCalls,
            totalSpentUsdc: agent.totalSpentUsdc,
            accountAgeDays,
        });
        const badge = calculateBadge(agent.totalCalls);
        await prisma.agent.update({
            where: { id: agentId },
            data: { reputationScore, badge },
        });
    }
    catch (e) {
        // Non-critical — don't crash the request
        console.error(`Failed to update reputation for agent ${agentId}:`, e);
    }
}
// ─── Record Success/Error ────────────────────────────────────────────────────
export async function recordAgentCall(agentId, success) {
    try {
        await prisma.agent.update({
            where: { id: agentId },
            data: success
                ? { successCount: { increment: 1 } }
                : { errorCount: { increment: 1 } },
        });
    }
    catch {
        // Non-critical
    }
}
// ─── Record Spend ────────────────────────────────────────────────────────────
export async function recordAgentSpend(agentId, amountUsdc) {
    try {
        await prisma.agent.update({
            where: { id: agentId },
            data: { totalSpentUsdc: { increment: amountUsdc } },
        });
    }
    catch {
        // Non-critical
    }
}
//# sourceMappingURL=reputation.js.map