import { Router } from "express";
import { requireApiKey } from "../middleware/auth.js";
import { planRateConfig } from "../lib/rateLimit.js";

export const limitsRouter = Router();

/**
 * GET /v1/limits
 * Returns execution and rate-limit limits for the caller.
 * If authenticated, returns the caller's plan limits. Otherwise returns free defaults.
 */
limitsRouter.get("/v1/limits", async (req: any, res) => {
  const defaults = planRateConfig("free");
  const toolTimeoutMs = Number(process.env.TOOL_TIMEOUT_MS || 15_000);

  // unauthenticated response (free defaults)
  res.json({
    ok: true,
    plan: "free",
    rate_limit: { per_minute: defaults.limit, window_ms: defaults.windowMs },
    tool_timeout_ms: toolTimeoutMs,
    scrape: {
      max_bytes: Number(process.env.SCRAPE_MAX_BYTES || 750_000),
      max_url_len: Number(process.env.SCRAPE_MAX_URL_LEN || 2048),
      max_selector_len: Number(process.env.SCRAPE_MAX_SELECTOR_LEN || 200),
      max_redirects: Number(process.env.SCRAPE_MAX_REDIRECTS || 3),
    },
    ai: {
      max_prompt_chars: Number(process.env.AI_MAX_PROMPT_CHARS || 10_000),
      max_system_chars: Number(process.env.AI_MAX_SYSTEM_CHARS || 2_000),
      max_tokens: Number(process.env.AI_MAX_TOKENS || 2048),
      allowed_models: (process.env.AI_ALLOWED_MODELS || "claude-sonnet-4-20250514,claude-3-5-sonnet-20241022,claude-3-5-haiku-20241022")
        .split(",").map((s)=>s.trim()).filter(Boolean),
      timeout_ms: Number(process.env.AI_TIMEOUT_MS || 20_000),
    },
  });
});

// Authenticated version with plan information (same path; client includes auth header).
limitsRouter.get("/v1/limits/auth", requireApiKey, async (req: any, res) => {
  const plan = (req.agentPlan || "free") as "free" | "pro" | "business";
  const cfg = planRateConfig(plan);
  res.json({
    ok: true,
    plan,
    rate_limit: { per_minute: cfg.limit, window_ms: cfg.windowMs },
  });
});
