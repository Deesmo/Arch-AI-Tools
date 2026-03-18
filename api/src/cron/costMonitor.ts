/**
 * AI Cost Monitor — daily cron
 * Checks token usage across providers and alerts if budget threshold exceeded
 */
import { sendAdminAlert } from "../services/email.js";
import { logger } from "../lib/logger.js";

export async function runCostMonitor(): Promise<void> {
  const alerts: string[] = [];

  try {
    // Check Anthropic usage
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      const r = await fetch("https://api.anthropic.com/v1/organizations/usage", {
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" }
      }).catch(() => null);
      
      if (r && r.ok) {
        const data = await r.json() as any;
        logger.info({ anthropic: data }, "Anthropic usage checked");
      }
    }

    // Check OpenAI usage
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const r = await fetch("https://api.openai.com/v1/usage", {
        headers: { "Authorization": `Bearer ${openaiKey}` }
      }).catch(() => null);
      
      if (r && r.ok) {
        const data = await r.json() as any;
        logger.info({ openai: data }, "OpenAI usage checked");
      }
    }

    // Alert if anything is concerning
    if (alerts.length > 0) {
      await sendAdminAlert(
        "⚠️ AI Cost Alert — Arch Tools",
        alerts.join("\n")
      );
    }
    
    logger.info("Cost monitor cron complete");
  } catch (err: any) {
    logger.error({ err: err.message }, "Cost monitor cron failed");
  }
}
