import { prisma } from "../lib/prisma.js";
import { fingerprintCaller } from "../lib/fingerprint.js";
import { sendLowCreditAlert, LOW_CREDIT_THRESHOLD } from "../services/email.js";
import { recordAgentCall, updateAgentReputation } from "../services/reputation.js";
import { fireWebhookEvent } from "../services/webhooks.js";
export async function deductCredits(req, res, toolName, cost) {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: crypto.randomUUID() });
        return false;
    }
    if (agent.credits < cost) {
        res.status(402).json({
            ok: false,
            error: "insufficient_credits",
            message: `Insufficient credits. You have ${agent.credits} credits but this tool costs ${cost}. Top up at https://archtools.dev/pricing — or earn 500 bonus credits by referring a friend (see /v1/referral/code).`,
            credits_remaining: agent.credits,
            credits_needed: cost,
            upgrade_url: "https://archtools.dev/pricing",
            referral_url: "https://archtools.dev/v1/referral/code",
            request_id: crypto.randomUUID(),
        });
        return false;
    }
    await prisma.agent.update({
        where: { id: agent.id },
        data: {
            credits: { decrement: cost },
            totalCalls: { increment: 1 },
        },
    });
    agent.credits -= cost;
    res.setHeader("X-Credits-Remaining", agent.credits.toString());
    res.setHeader("X-Credits-Used", cost.toString());
    if (agent.credits < 20) {
        res.setHeader("X-Upgrade-URL", "https://archtools.dev/pricing");
    }
    let finalized = false;
    const finalizeCharge = async () => {
        if (finalized)
            return;
        finalized = true;
        const succeeded = res.statusCode >= 200 && res.statusCode < 400;
        try {
            if (succeeded) {
                const fp = fingerprintCaller(req.headers["user-agent"]);
                await prisma.apiRequest.create({
                    data: {
                        agentId: agent.id,
                        toolName,
                        creditsUsed: cost,
                        status: "SUCCESS",
                        callerType: fp.callerType,
                        callerName: fp.callerName,
                        callerVersion: fp.callerVersion ?? null,
                    },
                });
                const today = new Date().toISOString().slice(0, 10);
                await prisma.dailyUsage.upsert({
                    where: { date_toolName: { date: today, toolName } },
                    update: { callCount: { increment: 1 } },
                    create: { date: today, toolName, callCount: 1 },
                });
                void recordAgentCall(agent.id, true);
                void updateAgentReputation(agent.id);
                return;
            }
            await prisma.agent.update({
                where: { id: agent.id },
                data: {
                    credits: { increment: cost },
                    totalCalls: { decrement: 1 },
                },
            });
            await logError(agent.id, toolName, 0);
        }
        catch {
            // Non-fatal; never block the response path
        }
    };
    res.once("finish", () => { void finalizeCharge(); });
    res.once("close", () => { void finalizeCharge(); });
    if (agent.credits <= LOW_CREDIT_THRESHOLD && agent.credits > 0) {
        prisma.agent.findUnique({ where: { id: agent.id }, select: { email: true } })
            .then(a => { if (a?.email)
            sendLowCreditAlert(a.email, agent.credits, agent.id).catch(() => { }); })
            .catch(() => { });
        fireWebhookEvent("credits.low", agent.id, {
            credits_remaining: agent.credits,
            tool_name: toolName,
            threshold: LOW_CREDIT_THRESHOLD,
        }).catch(() => { });
    }
    if (agent.credits <= 0) {
        fireWebhookEvent("credits.depleted", agent.id, {
            credits_remaining: 0,
            tool_name: toolName,
            message: "Your credit balance has reached zero. Purchase more at https://archtools.dev/pricing",
        }).catch(() => { });
    }
    return true;
}
export async function logError(agentId, toolName, cost) {
    try {
        await prisma.apiRequest.create({
            data: {
                agentId,
                toolName,
                creditsUsed: cost,
                status: "ERROR",
            },
        });
        void recordAgentCall(agentId, false);
        void updateAgentReputation(agentId);
        fireWebhookEvent("tool.error", agentId, {
            tool_name: toolName,
            credits_charged: cost,
        }).catch(() => { });
    }
    catch {
        // Non-fatal
    }
}
export function reqId() {
    return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
export function safeErr(e) {
    if (process.env.NODE_ENV === "production")
        return "An error occurred. Please try again.";
    return String(e);
}
//# sourceMappingURL=credits.js.map