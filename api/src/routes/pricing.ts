/**
 * GET /api/v1/x402/pricing
 *
 * Returns machine-readable pricing for all x402-enabled tools.
 * Useful for agents to calculate how much USDC to fund before calling tools.
 *
 * No authentication required — pricing is public.
 */

import { Router, Request, Response } from "express";
import { X402_PRICES } from "../middleware/x402.js";

const router = Router();

// ─── GET /api/v1/x402/pricing ─────────────────────────────────────────────────
router.get("/", (_req: Request, res: Response): void => {
  // Build structured pricing response
  const tools = Object.entries(X402_PRICES).map(([name, priceUsdc]) => ({
    tool: name,
    price_usdc: priceUsdc,
    price_atomic: Math.round(parseFloat(priceUsdc) * 1_000_000).toString(), // 6-decimal USDC atomic units
    endpoint: `/v1/tools/${name}`,
    method: "POST",
  }));

  // Sort by price ascending
  tools.sort((a, b) => parseFloat(a.price_usdc) - parseFloat(b.price_usdc));

  // Compute stats
  const prices = tools.map(t => parseFloat(t.price_usdc));
  const cheapest = Math.min(...prices);
  const mostExpensive = Math.max(...prices);
  const average = prices.reduce((s, p) => s + p, 0) / prices.length;

  res.setHeader("Cache-Control", "public, max-age=3600"); // cache 1h
  res.json({
    ok: true,
    currency: "USDC",
    network: "base (eip155:8453)",
    protocol: "x402",
    tool_count: tools.length,
    stats: {
      cheapest_usdc: cheapest.toFixed(3),
      most_expensive_usdc: mostExpensive.toFixed(3),
      average_usdc: average.toFixed(4),
      calls_per_dollar: {
        cheapest: Math.floor(1 / cheapest),
        average: Math.floor(1 / average),
        most_expensive: Math.floor(1 / mostExpensive),
      },
    },
    tools,
    _links: {
      fund: "https://archtools.dev/fund",
      wallets: "https://archtools.dev/wallets",
      docs: "https://archtools.dev/docs",
      x402_spec: "https://www.x402.org",
    },
  });
});

// ─── GET /api/v1/x402/pricing/:tool ──────────────────────────────────────────
// Get pricing for a specific tool
router.get("/:tool", (req: Request, res: Response): void => {
  const toolName = req.params.tool;
  const priceUsdc = X402_PRICES[toolName];

  if (!priceUsdc) {
    res.status(404).json({
      ok: false,
      error: "tool_not_found",
      message: `No x402 pricing found for tool "${toolName}". Check GET /api/v1/x402/pricing for available tools.`,
    });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({
    ok: true,
    tool: toolName,
    price_usdc: priceUsdc,
    price_atomic: Math.round(parseFloat(priceUsdc) * 1_000_000).toString(),
    endpoint: `/v1/tools/${toolName}`,
    method: "POST",
    currency: "USDC",
    network: "base (eip155:8453)",
    protocol: "x402",
    calls_per_dollar: Math.floor(1 / parseFloat(priceUsdc)),
  });
});

export default router;
