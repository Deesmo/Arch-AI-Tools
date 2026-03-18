/**
 * GET /api/v1/x402/playground/demo
 *
 * Returns a simulated x402 payment flow for demo purposes.
 * No real payment is made — shows what the full cycle looks like.
 */

import { Router, Request, Response } from "express";
import { X402_PRICES } from "../middleware/x402.js";
import { config } from "../config.js";

const router = Router();

// ─── GET /api/v1/x402/playground/demo ─────────────────────────────────────────
router.get("/demo", (req: Request, res: Response): void => {
  const toolName = (req.query.tool as string) || "generate-hash";
  const priceUsdc = X402_PRICES[toolName] || "0.001";
  const amountAtomic = Math.round(parseFloat(priceUsdc) * 1_000_000).toString();
  const walletAddress = config.x402.walletAddress || "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18";
  const network = config.x402.network === "base-sepolia" ? "eip155:84532" : "eip155:8453";
  const baseUrl = config.publicSiteUrl || "https://archtools.dev";
  const resource = `${baseUrl}/v1/tools/${toolName}`;

  // Simulated timestamps
  const now = new Date();
  const requestTime = now.toISOString();
  const paymentTime = new Date(now.getTime() + 340).toISOString();
  const responseTime = new Date(now.getTime() + 1820).toISOString();

  // Simulated tx hash
  const txHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

  res.json({
    ok: true,
    demo: true,
    tool: toolName,
    price_usdc: priceUsdc,
    flow: {
      step_1_request: {
        description: "Agent sends request with no API key",
        method: "POST",
        url: resource,
        headers: {
          "Content-Type": "application/json",
        },
        timestamp: requestTime,
      },
      step_2_payment_required: {
        description: "Server responds with 402 + payment instructions",
        status: 402,
        headers: {
          "X-Payment-Required": "true",
          "Content-Type": "application/json",
        },
        body: {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network,
              maxAmountRequired: amountAtomic,
              resource,
              description: `Arch Tools — ${toolName}`,
              payTo: walletAddress,
              maxTimeoutSeconds: 60,
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              extra: { name: "USD Coin", version: "2" },
            },
          ],
        },
      },
      step_3_payment: {
        description: "Agent signs USDC transfer and retries with X-Payment header",
        method: "POST",
        url: resource,
        headers: {
          "Content-Type": "application/json",
          "X-Payment": "eyJwYXlsb2FkIjp7InNpZ25hdHVyZSI6IjB4Li4uIiwidHJhbnNmZXIiOnsiYW1vdW50IjoiMTAwMCIsInRvIjoiMHg3NDJkMzVDYzY2MzRDMDUzMjkyNWEzYjg0NEJjOWU3NTk1ZjJiRDE4In19fQ==",
        },
        timestamp: paymentTime,
      },
      step_4_response: {
        description: "Server verifies payment, executes tool, returns result",
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Payment-Verified": "true",
          "X-Payment-TxHash": txHash,
        },
        body: {
          ok: true,
          tool: toolName,
          x402: {
            paid: true,
            amount_usdc: priceUsdc,
            tx_hash: txHash,
            network: "base",
            settled_at: responseTime,
          },
          result: getDemoResult(toolName),
        },
        timestamp: responseTime,
      },
    },
    timing: {
      total_ms: 1820,
      payment_verification_ms: 340,
      tool_execution_ms: 1480,
    },
  });
});

// ─── GET /api/v1/x402/playground/tools ────────────────────────────────────────
// Returns all tools with pricing + sample params for the playground
router.get("/tools", (_req: Request, res: Response): void => {
  const tools = Object.entries(X402_PRICES).map(([name, price]) => ({
    name,
    price_usdc: price,
    endpoint: `/v1/tools/${name}`,
    sample_params: getSampleParams(name),
  }));

  tools.sort((a, b) => a.name.localeCompare(b.name));

  res.json({
    ok: true,
    tool_count: tools.length,
    tools,
  });
});

function getSampleParams(tool: string): Record<string, unknown> {
  const samples: Record<string, Record<string, unknown>> = {
    "validate-data": { schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, data: { name: "Brad" } },
    "generate-hash": { input: "hello world", algorithm: "sha256" },
    "qr-code": { text: "https://archtools.dev", format: "dataurl" },
    "convert-format": { from: "json", to: "yaml", data: { name: "Arch Tools" } },
    "transform-text": { text: "Hello World from Arch Tools", mode: "slug" },
    "extract-metadata": { url: "https://archtools.dev" },
    "web-scrape": { url: "https://example.com", format: "text" },
    "ai-generate": { prompt: "Write a one-sentence pitch for Arch Tools.", model: "claude-haiku-4-5-20251001" },
    "search-web": { query: "latest AI agent frameworks 2025", limit: 5 },
    "extract-page": { url: "https://example.com" },
    "browser-task": { url: "https://news.ycombinator.com", action: "extract", selector: ".titleline" },
    "ocr-extract": { image_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Fondue_de_fromage.jpg/800px-Fondue_de_fromage.jpg" },
    "ip-lookup": { ip: "8.8.8.8" },
    "email-verify": { email: "test@gmail.com" },
    "phone-validate": { phone: "+1 (212) 555-0100", country_code: "US" },
    "currency-convert": { amount: 100, from: "USD", to: "EUR" },
    "timezone-convert": { datetime: "2025-06-01T12:00:00Z", from_tz: "America/New_York", to_tz: "Asia/Tokyo" },
    "web-search": { query: "Arch Tools API", max_results: 5 },
    "sentiment-analysis": { text: "Arch Tools is absolutely incredible! Best API I have ever used." },
    "summarize": { text: "Arch Tools provides 58 production-ready API tools for developers and AI agents.", style: "tldr" },
    "extract-entities": { text: "Brad Valdes founded Arch Enterprises LLC in Columbia, South Carolina." },
    "language-detect": { text: "Bonjour, comment allez-vous?" },
    "pii-detect": { text: "Contact John Smith at john@example.com or 555-123-4567.", redact: true },
    "readability-score": { text: "Arch Tools provides a comprehensive API platform for developers." },
    "rss-parse": { url: "https://feeds.arstechnica.com/arstechnica/index", limit: 5 },
    "generate-uuid": { type: "v4", count: 3 },
    "regex-generate": { description: "Match a valid US phone number" },
    "diff-text": { original: "The quick brown fox", modified: "The quick red fox jumps" },
    "whois-lookup": { domain: "archtools.dev" },
    "extract-pdf": { pdf_url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" },
    "screenshot-capture": { url: "https://archtools.dev", width: 1280, height: 800 },
    "html-to-markdown": { html: "<h1>Hello</h1><p>World</p>" },
    "url-shorten": { url: "https://archtools.dev/docs/getting-started" },
    "webhook-send": { webhook_url: "https://httpbin.org/post", payload: { test: true } },
    "jsonpath-query": { data: { store: { book: [{ title: "AI Agents" }] } }, path: "$.store.book[*].title" },
    "image-generate": { prompt: "A futuristic AI agent dashboard", size: "1024x1024" },
    "barcode-generate": { text: "123456789", format: "CODE128" },
    "workflow-agent": { goal: "Find the weather in NYC and summarize it", max_steps: 3 },
    "crypto-price": { symbol: "bitcoin" },
    "crypto-ohlcv": { symbol: "ethereum", days: 7 },
    "crypto-market-cap": { limit: 10 },
    "crypto-fear-greed": { limit: 1 },
    "crypto-sentiment": { symbol: "bitcoin" },
    "crypto-news": { limit: 5 },
    "token-lookup": { query: "solana" },
    "ai-oracle": { question: "What are the top AI agent frameworks in 2025?" },
    "session-create": { system: "You are a helpful assistant", model: "claude" },
    "session-message": { session_id: "demo-session-id", message: "Hello!" },
    "text-to-speech": { text: "Welcome to Arch Tools" },
    "transcribe-audio": { audio_url: "https://example.com/audio.mp3" },
    "email-send": { to: "demo@example.com", subject: "Test", body: "Hello from Arch Tools" },
    "design-create": { prompt: "Modern logo for an AI startup" },
    "domain-check": { domain: "archtools.dev" },
    "news-search": { query: "AI agents", limit: 5 },
    "research-report": { topic: "State of AI agents in 2025", depth: "brief" },
    "fact-check": { claim: "The Earth orbits the Sun" },
    "video-generate": { prompt: "A sunrise over mountains", duration: 4 },
    "image-remove-bg": { image_url: "https://example.com/photo.jpg" },
    "email-find": { domain: "google.com", first_name: "John" },
    "semantic-search": { query: "best AI development tools" },
    "social-post": { text: "Testing Arch Tools x402 payments! 🚀" },
  };

  return samples[tool] || { input: "test" };
}

function getDemoResult(tool: string): unknown {
  const results: Record<string, unknown> = {
    "generate-hash": { algorithm: "sha256", hash: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9" },
    "ip-lookup": { ip: "8.8.8.8", city: "Mountain View", region: "California", country: "US", org: "Google LLC" },
    "ai-generate": { text: "Arch Tools gives AI agents 58 production-ready APIs with built-in x402 USDC payments — no API key required." },
    "crypto-price": { symbol: "bitcoin", price_usd: 104250.42, change_24h: 2.3 },
    "sentiment-analysis": { sentiment: "positive", score: 0.95, label: "Very Positive" },
  };
  return results[tool] || { status: "success", message: `${tool} executed successfully` };
}

export default router;
