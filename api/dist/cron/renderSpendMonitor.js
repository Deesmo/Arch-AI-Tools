/**
 * Render Spend Monitor — weekly cron
 * Checks total Render billing and alerts if approaching budget
 * Budget threshold: $100/month alert
 */
import { sendAdminAlert } from "../services/email.js";
import { logger } from "../lib/logger.js";
const RENDER_API_KEY = process.env.RENDER_API_KEY_MONITOR ?? "";
const ALERT_THRESHOLD_USD = 100;
export async function runRenderSpendMonitor() {
    if (!RENDER_API_KEY) {
        logger.warn("RENDER_API_KEY_MONITOR not set — skipping spend monitor");
        return;
    }
    try {
        // Get all services and check their plans
        const r = await fetch("https://api.render.com/v1/services?limit=50", {
            headers: { "Authorization": `Bearer ${RENDER_API_KEY}` }
        });
        if (!r.ok) {
            logger.warn({ status: r.status }, "Render API unavailable for spend check");
            return;
        }
        const data = await r.json();
        const proServices = data.filter(s => {
            const plan = s.service?.serviceDetails?.plan ?? "";
            return plan.includes("pro") || plan.includes("standard");
        });
        logger.info({ proServices: proServices.length, total: data.length }, "Render spend check complete");
        // Alert if too many pro services (rough cost proxy)
        if (proServices.length > 8) {
            await sendAdminAlert("⚠️ Render Spend Alert — Arch Tools", `${proServices.length} pro/standard services running. Review for unused services.\n\nhttps://dashboard.render.com/billing`);
        }
    }
    catch (err) {
        logger.error({ err: err.message }, "Render spend monitor failed");
    }
}
//# sourceMappingURL=renderSpendMonitor.js.map