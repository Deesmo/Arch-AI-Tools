import * as Sentry from "@sentry/node";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { config } from "./config.js";

// ESM-compatible __dirname (safe in both CommonJS and ESM builds)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Init Sentry before anything else
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? "development", tracesSampleRate: 0.1 });
}

// Routes
import discoveryRouter from "./routes/discovery.js";
import agentRouter from "./routes/agent.js";
import { requireAuth, AuthedRequest } from "./middleware/auth.js";
import toolsRouter from "./routes/tools/index.js";
import billingRouter from "./routes/billing.js";
import adminRouter from "./routes/admin.js";
import workflowsRouter from "./routes/workflows.js";
import seoRouter from "./routes/seo.js";
import legalRouter from "./routes/legal.js";
import oauthRouter from "./routes/oauth.js";
import authRouter, { verifySession } from "./routes/auth.js";
import chatRouter from "./routes/chat.js";
import directoryRouter from "./routes/directory.js";
import walletRouter from "./routes/wallet.js";
import pricingRouter from "./routes/pricing.js";
import playgroundRouter from "./routes/playground.js";
import x402PaymentsRouter from "./routes/x402-payments.js";
import facilitatorRouter from "./routes/facilitator.js";
import agentsRouter from "./routes/agents.js";
import webhooksRouter from "./routes/webhooks.js";
import mcpMarketplaceRouter from "./routes/mcp-marketplace.js";
import referralRouter from "./routes/referral.js";
import trialRouter from "./routes/trial.js";
import affiliateRouter from "./routes/affiliate.js";

// x402 SDK (official Coinbase @x402/express integration)
import { initX402Sdk, x402SdkMiddleware, getX402SdkStatus, warmX402Sdk } from "./middleware/x402-sdk.js";
import { SIGNUP_HTML } from "./assets/signupHtml.js";
import { DASHBOARD_HTML } from "./assets/dashboardHtml.js";
import { LOGIN_HTML } from "./assets/loginHtml.js";

// Analytics
import { analyticsMiddleware } from "./middleware/analytics.js";
import analyticsRouter from "./routes/analytics.js";
import statsRouter from "./routes/stats.js";

const app = express();
const corsOrigins = config.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// ─── Trust proxy (Render sits behind one) ────────────────────────────────────
app.set("trust proxy", 1);

// ─── Canonical-host redirect: *.onrender.com → archtools.dev ─────────────────
// Keeps the Render origin from being indexed/used directly. /health stays
// exempt so Render health checks keep passing.
app.use((req: Request, res: Response, next: NextFunction) => {
  const host = (req.headers.host ?? "").toLowerCase();
  if (host.endsWith(".onrender.com") && req.path !== "/health") {
    return res.redirect(301, `https://archtools.dev${req.originalUrl}`);
  }
  next();
});

// ─── Security headers (helmet) ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://browser.sentry-cdn.com", "https://js.sentry-cdn.com", "https://www.clarity.ms", "https://*.clarity.ms", "https://assets.apollo.io", "https://cdnjs.cloudflare.com", "https://static.cloudflareinsights.com"],  // inline scripts + Chart.js + Sentry (browser+js loader) + MS Clarity + Apollo + Prism (cdnjs) + Cloudflare Insights
      "script-src-attr": ["'unsafe-inline'"],  // allow inline event handlers (onclick etc)
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://archtools.dev", "https://arch-ai-tools.onrender.com", "https://pay.coinbase.com", "https://*.sentry.io", "https://*.ingest.sentry.io", "https://www.clarity.ms", "https://*.clarity.ms", "https://assets.apollo.io", "https://*.apollo.io", "https://aplo-evnt.com", "https://*.aplo-evnt.com", "https://cloudflareinsights.com"],
    },
  },
  crossOriginEmbedderPolicy: false,  // needed for fonts/CDN
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
// Global limit (all routes) — stops bots and DoS
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = req.headers.authorization;
    return auth?.startsWith("Bearer ") ? auth.slice(7, 40) : (req.ip ?? "unknown");
  },
  message: { ok: false, error: "rate_limited", message: "Too many requests. Slow down." },
  skip: (req) => req.path === "/health" || req.path.startsWith("/.well-known"),
});



// Auth endpoint limit — prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { ok: false, error: "rate_limited", message: "Too many auth attempts. Try again in 15 minutes." },
});

// Registration-specific limit — prevent credit farming via bulk account creation
// 5 new accounts per IP per hour is generous for real users, blocks bots
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { ok: false, error: "rate_limited", message: "Too many registration attempts. Try again in 1 hour." },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  exposedHeaders: [
    "Payment-Required",
    "Payment-Signature",
    "Payment-Response",
    "X-Payment",
    "X-Payment-Response",
    "X-Payment-Required",
  ],
}));
app.use(morgan("combined"));
app.use(globalLimiter);

// Stripe webhook needs raw body — must come before express.json()
app.use("/webhooks/stripe", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// ─── Request ID ───────────────────────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.headers["x-request-id"] = req.headers["x-request-id"] ?? crypto.randomUUID();
  next();
});

// ─── Analytics middleware (response timing + metrics) ─────────────────────────
app.use(analyticsMiddleware);

// ─── Favicon — redirect to SVG icon ──────────────────────────────────────────
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(__dirname, '../public/favicon.ico'), (err) => {
  if (err) res.redirect(301, '/arch-icon.svg?v=2');
}));

// ─── Static files (landing page) ─────────────────────────────────────────────
// HTML files: no-cache so browsers always revalidate (prevents stale JS/CSS bugs)
// Assets (images, icons): allow caching
app.use(express.static(path.join(__dirname, "../public"), {
  dotfiles: 'allow', // allow .well-known directory to be served
  redirect: false, // don't 301 /integrations -> /integrations/ (dir of SDK files); let the extensionless fallback serve integrations.html
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (filePath.match(/\.(png|jpg|svg|ico|webp)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (filePath.endsWith('.json') && filePath.includes('.well-known')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Type', 'application/json');
    }
  }
}));

// ─── .well-known/glama.json — Glama ownership verification ──────────────
app.get("/.well-known/glama.json", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({
    "$schema": "https://glama.ai/mcp/schemas/server.json",
    "maintainers": ["Deesmo"]
  });
});

// ─── og-image.png — serve actual PNG from public directory ──────────────
app.get("/og-image.png", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(path.join(__dirname, "../public/og-image.png"));
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Discovery & health (no auth)
app.use("/", discoveryRouter);

// /api/discovery — alias for /v1/tools (agent-friendly discovery endpoint)
app.get("/api/discovery", async (_req: Request, res: Response): Promise<void> => {
  try {
    // Forward internally to the /v1/tools handler via fetch-self
    const { prisma } = await import("./lib/prisma.js");
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — `active` exists in prod schema
    const tools = await prisma.tool.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    const mapped = tools.map((t: { name: string; description: string | null; credits: number | null; category: string | null }) => ({
      name: t.name,
      description: t.description ?? "",
      endpoint: `/v1/tools/${t.name}`,
      method: "POST",
      credits: t.credits ?? 5,
      category: t.category ?? "utility",
    }));
    res.json({ ok: true, tools: mapped });
  } catch {
    res.json({ ok: true, tools: [] });
  }
});

// SEO free tool pages + no-auth API endpoints
app.use("/tools", seoRouter);
app.use("/v1/tools", seoRouter);  // Free endpoint proxies

// Agent registration — tight limit to prevent credit farming
app.use("/v1/agent/register", registerLimiter);
// Agent usage & other agent routes — auth brute force protection
app.use("/v1/agent", authLimiter, agentRouter);

// Aliases — /v1/account and /v1/credits point to the same agent router
app.use("/v1/account", authLimiter, agentRouter);
app.get("/v1/credits", requireAuth, async (req: AuthedRequest, res: Response) => {
  // Thin alias → same as GET /v1/agent/balance
  req.url = "/balance";
  agentRouter(req, res, () => res.status(404).json({ ok: false, error: "not_found" }));
});

// OAuth (rate limited to prevent brute force)
app.use("/oauth", authLimiter, oauthRouter);

// x402 SDK middleware (PRIMARY) — official Coinbase @x402/express protocol
// SDK middleware DISABLED — causes infinite hangs on Render/Cloudflare setup.
// Custom x402.ts middleware in toolMiddleware() handles all payments.
// app.use("/v1/tools", x402SdkMiddleware);

// Tool calls (tier-based rate limiting handled inside toolMiddleware, post-auth)
app.use("/v1/tools", toolsRouter);

// Billing
app.use("/v1/billing", billingRouter);
app.use("/webhooks", billingRouter);

// Admin
app.use("/v1/admin", adminRouter);
app.use("/admin", adminRouter);

// Analytics (admin-only API + public stats)
app.use("/api/v1/analytics", analyticsRouter);
app.use("/api/v1/stats", statsRouter);

// x402 Service Directory
app.use("/api/v1/x402/directory", directoryRouter);

// x402 Pricing API (public, no auth)
app.use("/api/v1/x402/pricing", pricingRouter);

// x402 Playground API (public, no auth — demo flow)
app.use("/api/v1/x402/playground", playgroundRouter);

// x402 Payment receipts & history
app.use("/api/v1/x402", x402PaymentsRouter);

// Facilitator-as-a-Service — let other API providers use Arch Tools as their x402 facilitator
app.use("/api/v1/facilitator", facilitatorRouter);

// Referral system
app.use("/api/v1/referral", referralRouter);

// Free trial system
app.use("/v1/trial", trialRouter);

// Affiliate tracking
app.use("/v1/affiliate", affiliateRouter);

// Agent Identity (KYA — Know Your Agent)
app.use("/api/v1/agents", agentsRouter);

// Webhooks — event notification system
app.use("/api/v1/webhooks", webhooksRouter);

// MCP Server Marketplace — curated MCP server directory
app.use("/api/v1/mcp", mcpMarketplaceRouter);

// Wallet provisioning (AgentKit)
app.use("/v1/wallet", walletRouter);

// Workflows
app.use("/v1/workflows", workflowsRouter);

// Legal
app.use("/legal", legalRouter);
app.use("/auth", authRouter);

// Chat widget (public, rate-limited server-side proxy)
app.use("/api/chat", chatRouter);

// ─── Frontend pages ───────────────────────────────────────────────────────────
app.get("/signup", (_req: Request, res: Response) => res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate").set("Pragma", "no-cache").set("Expires", "0").type("text/html").send(SIGNUP_HTML));
app.get("/register", (_req: Request, res: Response) => res.redirect(301, "/signup"));
app.get("/login", (_req: Request, res: Response) => res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate").set("Pragma", "no-cache").set("Expires", "0").type("text/html").send(LOGIN_HTML));
app.get("/dashboard", (req: Request, res: Response) => {
  const token = req.cookies?.arch_session;
  if (!token || !verifySession(token)) {
    return res.redirect(302, "/login?next=/dashboard");
  }
  return res.type("text/html").send(DASHBOARD_HTML);
});

// Convenience redirects for billing/usage paths referenced in emails & docs
app.get("/billing", (_req: Request, res: Response) => res.redirect(302, "/pricing"));
app.get("/dashboard/usage", (_req: Request, res: Response) => res.redirect(302, "/dashboard"));
app.get("/dashboard/billing", (_req: Request, res: Response) => res.redirect(302, "/pricing"));
app.get("/dashboard/byok", (_req: Request, res: Response) => res.redirect(302, "/byok"));

// ─── Missing pages (referenced throughout the app) ────────────────────────────
// /pricing — full pricing page
app.get("/pricing", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/pricing.html')));
// /getting-started — convenience redirect to docs sub-path
app.get("/langchain-guide", (_req, res) => res.sendFile(path.join(__dirname, '../public/langchain-guide.html')));
app.get("/byok", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/byok.html')));
app.get("/quickstart", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/quickstart.html')));
app.get("/getting-started", (_req: Request, res: Response) => res.redirect(301, "/docs/getting-started"));
// /terms — serve the static terms page directly (no 301 hop)
app.get("/terms", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, "../public/terms.html")));
// /privacy — serve the static privacy page directly (no 301 hop to /legal/privacy)
app.get("/privacy", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, "../public/privacy.html")));

// /docs — full API reference page
app.get("/changelog", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/changelog.html')));
app.get("/directory", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/directory.html')));
app.get("/docs", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/docs.html')));
app.get("/docs/getting-started", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/getting-started.html')));
app.get("/docs/:slug", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/docs.html')));
app.get("/blog-x402-vs-stripe", (_req, res) => res.sendFile(path.join(__dirname, '../public/blog-x402-vs-stripe.html')));
app.get("/blog-mcp-guide", (_req, res) => res.sendFile(path.join(__dirname, '../public/blog-mcp-guide.html')));
app.get("/blog-agents-need-crypto", (_req, res) => res.sendFile(path.join(__dirname, '../public/blog-agents-need-crypto.html')));
app.get("/blog", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/blog.html')));
app.get("/blog/:slug", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/blog.html')));
app.get("/sdk", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/sdk.html')));
app.get("/fund", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/fund.html')));
// /wallet → 302 redirect to /fund (302 not 301 — keeps it reversible if /wallet becomes its own page)
app.get("/wallet", (_req: Request, res: Response) => res.redirect(302, "/fund"));
app.get("/playground", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/playground.html')));
app.get("/use-cases", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/use-cases.html')));
app.get("/agents", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/agents.html')));
app.get("/analytics", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/analytics.html')));
// Admin panel — serve the public login shell. It holds no secrets: the key lives
// in the browser's localStorage and is sent as x-admin-key on data fetches, which
// requireAdmin validates (timing-safe). Gating the HTML here would 401 every real
// browser navigation, since the login UI is what collects the key in the first place.
app.get("/admin.html", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get("/admin", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get("/sitemap.xml", (_req, res) => res.sendFile(path.join(__dirname, '../public/sitemap.xml')));
app.get("/robots.txt", (_req, res) => res.sendFile(path.join(__dirname, '../public/robots.txt')));
app.get("/x402-guide", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/x402-guide.html')));
app.get("/langchain-guide", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/langchain-guide.html')));
app.get("/refer", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/refer.html')));
app.get("/landing-b", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/landing-b.html')));
app.get("/changelog-tonight", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/changelog-tonight.html')));
app.get("/agents", (_req: Request, _res: Response) => _res.sendFile(path.join(__dirname, '../public/agents-landing.html')));
// /register → /signup redirect (common developer habit)
app.get("/register", (_req: Request, res: Response) => res.redirect(301, "/signup"));
// /get-api-key → /signup redirect (homepage CTA target)
app.get("/get-api-key", (_req: Request, res: Response) => res.redirect(301, "/signup"));

app.get("/usage", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/usage.html')));
app.get("/status", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/status.html')));
app.get("/stats", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/stats.html')));
app.get("/facilitator", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/facilitator.html')));
app.get("/webhooks", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/webhooks.html')));
app.get("/developers", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/developers.html')));
app.get("/mcp-marketplace", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/mcp-marketplace.html')));
app.get("/mcp-setup", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/mcp-setup.html')));
app.get("/sdks", (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '../public/sdks.html')));
app.get("/v1/changelog.rss", (_req: Request, res: Response) => {
  res.type("application/rss+xml").sendFile(path.join(__dirname, '../public/changelog.rss'));
});

// /success — Stripe post-checkout success page
app.get("/success", (_req: Request, res: Response) => {
  res.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payment Successful — Arch Tools</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#07061A;color:#f0f0f6;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#0c0c16;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:48px;text-align:center;max-width:480px}
    h1{font-size:2rem;margin:0 0 12px;color:#00e5b0}
    p{color:#8b8ba6;margin:0 0 24px;font-size:16px;line-height:1.6}
    a{display:inline-block;background:#00e5b0;color:#07061A;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px}
    .icon{font-size:3rem;margin-bottom:16px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Payment Successful</h1>
    <p>Your credits have been added to your account. You're ready to build.</p>
    <a href="/dashboard">Open Dashboard →</a>
  </div>
</body>
</html>`);
});




// x402 SDK status endpoint
app.get("/v1/x402/status", (_req: Request, res: Response) => {
  res.json({ ok: true, x402_sdk: getX402SdkStatus() });
});

app.get("/v1/health/x402", async (_req: Request, res: Response) => {
  try {
    const testUrl = `http://localhost:${process.env.PORT ?? 10000}/v1/tools/generate-hash`;
    const r = await fetch(testUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "gate-test" }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    const gateWorking = r?.status === 402;
    res.status(gateWorking ? 200 : 503).json({
      ok: gateWorking,
      gate_status: gateWorking ? "ok" : "BROKEN",
      expected_status: 402,
      actual_status: r?.status ?? "error",
      message: gateWorking
        ? "x402 payment gate is working correctly - unauthenticated requests return 402"
        : "CRITICAL: x402 payment gate is BROKEN - unauthenticated requests are not returning 402",
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, gate_status: "ERROR", message: String(err) });
  }
});

// ─── Extensionless HTML fallback ─────────────────────────────────────────────
// Serves /integrations, /docs-x402-guide, /faq, etc. when public/<name>.html exists
// and no explicit route matched above. GET/HEAD only; single path segment only.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const m = /^\/([A-Za-z0-9_-]+)$/.exec(req.path);
  if (!m) return next();
  const file = path.join(__dirname, "../public", `${m[1]}.html`);
  if (!fs.existsSync(file)) return next();
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(file, (err) => { if (err) next(); });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req: Request, res: Response) => {
  const requestId = crypto.randomUUID();
  const wantsHtml = req.accepts(["json", "html"]) === "html";
  if (wantsHtml) {
    res.status(404).type("html").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>404 — Page not found | Arch Tools</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#07061a;color:#f0f0f6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;min-height:100vh}
  .wrap{max-width:560px;margin:0 auto;padding:80px 24px;text-align:center}
  .code{font-size:72px;font-weight:800;letter-spacing:-0.06em;background:linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:8px}
  h1{font-size:22px;font-weight:700;margin:0 0 12px}
  p{font-size:14px;line-height:1.6;color:rgba(255,255,255,0.65);margin:0 0 28px}
  .links{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:24px}
  a.btn{display:inline-block;padding:10px 18px;border-radius:10px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);color:#22d3ee;text-decoration:none;font-weight:600;font-size:13px}
  a.btn.primary{background:linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);border:0;color:#fff}
  a.btn:hover{background:rgba(255,255,255,0.12)}
  .rid{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;color:rgba(255,255,255,0.35);margin-top:20px;word-break:break-all}
</style></head><body><div class="wrap">
  <div class="code">404</div>
  <h1>That page doesn't exist.</h1>
  <p>The URL you tried isn't a known route. If you came from a link inside Arch Tools, let us know so we can fix it.</p>
  <div class="links">
    <a class="btn primary" href="/">Home</a>
    <a class="btn" href="/docs">Docs</a>
    <a class="btn" href="/pricing">Pricing</a>
    <a class="btn" href="/dashboard">Dashboard</a>
  </div>
  <div class="rid">request_id: ${requestId}</div>
</div></body></html>`);
    return;
  }
  res.status(404).json({
    ok: false,
    error: "not_found",
    message: `No route matches ${req.method} ${req.path}. See https://archtools.dev/docs or GET /v1/tools for the list of available tools.`,
    docs_url: "https://archtools.dev/docs",
    tools_list_url: "https://archtools.dev/v1/tools",
    request_id: requestId,
  });
});

// ─── Error handler ───────────────────────────────────────────────────────────
// x402 Payment Gate Health Check — public, no auth
// Returns whether the payment gate is working correctly
app.get("/v1/health/x402", async (_req: Request, res: Response) => {
  try {
    // Self-test: call a tool endpoint without auth and check for 402
    const testUrl = `http://localhost:${process.env.PORT ?? 10000}/v1/tools/generate-hash`;
    const r = await fetch(testUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "gate-test" }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    
    const gateWorking = r?.status === 402;
    const status = gateWorking ? "ok" : "BROKEN";
    
    res.status(gateWorking ? 200 : 503).json({
      ok: gateWorking,
      gate_status: status,
      expected_status: 402,
      actual_status: r?.status ?? "error",
      message: gateWorking 
        ? "x402 payment gate is working correctly — unauthenticated requests return 402"
        : "CRITICAL: x402 payment gate is BROKEN — unauthenticated requests are not returning 402",
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, gate_status: "ERROR", message: String(err) });
  }
});


app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    ok: false,
    error: "internal_error",
    message: config.nodeEnv === "development" ? err.message : "Internal server error",
    request_id: crypto.randomUUID(),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
// Startup guard — fail fast if ADMIN_KEY is insecure
if (config.nodeEnv === "production" && (!process.env.ADMIN_KEY || process.env.ADMIN_KEY === "changeme")) {
  console.error("FATAL: ADMIN_KEY must be set to a secure value in production. Exiting.");
  process.exit(1);
}

// Initialize x402 SDK (official Coinbase protocol support)
// Pre-warm BEFORE accepting connections: fetch CDP /supported so feePayer is ready.
// Without this, the first payment request triggers a blocking CDP network call.
// x402 SDK init disabled — SDK middleware is commented out above
// initX402Sdk();

app.listen(config.port, () => {
  console.log(`⚡ Arch Tools API v1.5.0 running on port ${config.port}`);
  console.log(`   ENV: ${config.nodeEnv}`);
  console.log(`   Site: ${config.publicSiteUrl}`);
});

// Daily cleanup of expired OAuth records
setInterval(async () => {
  try {
    const { cleanupExpiredOAuthRecords } = await import("./lib/systemJobs");
    await cleanupExpiredOAuthRecords();
  } catch { /* non-fatal */ }
}, 24 * 60 * 60 * 1000);

// MCP anonymous-demo pool auto-top-off — hourly, hard-capped per month.
// First line of defense = per-IP/global daily anon caps in the MCP server;
// this is the bounded-credit backstop (see src/cron/demoTopoff.ts).
setInterval(async () => {
  try {
    const { runDemoTopoff } = await import("./cron/demoTopoff");
    await runDemoTopoff();
  } catch { /* non-fatal */ }
}, 60 * 60 * 1000);
setTimeout(async () => {
  try {
    const { runDemoTopoff } = await import("./cron/demoTopoff");
    await runDemoTopoff();
  } catch { /* non-fatal */ }
}, 90 * 1000); // one kick shortly after boot

export default app;
