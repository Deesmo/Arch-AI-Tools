import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";
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
import toolsRouter from "./routes/tools/index.js";
import billingRouter from "./routes/billing.js";
import adminRouter from "./routes/admin.js";
import workflowsRouter from "./routes/workflows.js";
import seoRouter from "./routes/seo.js";
import legalRouter from "./routes/legal.js";
import oauthRouter from "./routes/oauth.js";
import authRouter, { verifySession } from "./routes/auth.js";
import { SIGNUP_HTML } from "./assets/signupHtml.js";
import { DASHBOARD_HTML } from "./assets/dashboardHtml.js";
import { LOGIN_HTML } from "./assets/loginHtml.js";
const app = express();
// ─── Trust proxy (Render sits behind one) ────────────────────────────────────
app.set("trust proxy", 1);
// ─── Security headers (helmet) ────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"], // landing page inline scripts
            "script-src-attr": ["'unsafe-inline'"], // allow inline event handlers (onclick etc)
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://archtools.dev", "https://arch-ai-tools.onrender.com"],
        },
    },
    crossOriginEmbedderPolicy: false, // needed for fonts/CDN
}));
// ─── Rate Limiting ────────────────────────────────────────────────────────────
// Global limit (all routes) — stops bots and DoS
const globalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
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
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
    message: { ok: false, error: "rate_limited", message: "Too many auth attempts. Try again in 15 minutes." },
});
// Registration-specific limit — prevent credit farming via bulk account creation
// 5 new accounts per IP per hour is generous for real users, blocks bots
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
    message: { ok: false, error: "rate_limited", message: "Too many registration attempts. Try again in 1 hour." },
});
// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(morgan("combined"));
app.use(globalLimiter);
// Stripe webhook needs raw body — must come before express.json()
app.use("/webhooks/stripe", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
// ─── Request ID ───────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
    req.headers["x-request-id"] = req.headers["x-request-id"] ?? crypto.randomUUID();
    next();
});
// ─── Favicon — redirect to SVG icon ──────────────────────────────────────────
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(__dirname, '../public/favicon.ico'), (err) => {
    if (err)
        res.redirect(301, '/arch-icon.svg');
}));
// ─── Static files (landing page) ─────────────────────────────────────────────
// HTML files: no-cache so browsers always revalidate (prevents stale JS/CSS bugs)
// Assets (images, icons): allow caching
app.use(express.static(path.join(__dirname, "../public"), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
        else if (filePath.match(/\.(png|jpg|svg|ico|webp)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));
// ─── og-image.png — serve actual PNG from public directory ──────────────
app.get("/og-image.png", (_req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(path.join(__dirname, "../public/og-image.png"));
});
// ─── Routes ───────────────────────────────────────────────────────────────────
// Discovery & health (no auth)
app.use("/", discoveryRouter);
// SEO free tool pages + no-auth API endpoints
app.use("/tools", seoRouter);
app.use("/v1/tools", seoRouter); // Free endpoint proxies
// Agent registration — tight limit to prevent credit farming
app.use("/v1/agent/register", registerLimiter);
// Agent usage & other agent routes — auth brute force protection
app.use("/v1/agent", authLimiter, agentRouter);
// OAuth (rate limited to prevent brute force)
app.use("/oauth", authLimiter, oauthRouter);
// Tool calls (tier-based rate limiting handled inside toolMiddleware, post-auth)
app.use("/v1/tools", toolsRouter);
// Billing
app.use("/v1/billing", billingRouter);
app.use("/webhooks", billingRouter);
// Admin
app.use("/v1/admin", adminRouter);
app.use("/admin", adminRouter);
// Workflows
app.use("/v1/workflows", workflowsRouter);
// Legal
app.use("/legal", legalRouter);
app.use("/auth", authRouter);
// ─── Frontend pages ───────────────────────────────────────────────────────────
app.get("/signup", (_req, res) => res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate").set("Pragma", "no-cache").set("Expires", "0").type("text/html").send(SIGNUP_HTML));
app.get("/login", (_req, res) => res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate").set("Pragma", "no-cache").set("Expires", "0").type("text/html").send(LOGIN_HTML));
app.get("/dashboard", (req, res) => {
    const token = req.cookies?.arch_session;
    if (!token || !verifySession(token)) {
        return res.redirect(302, "/login?next=/dashboard");
    }
    return res.type("text/html").send(DASHBOARD_HTML);
});
// ─── Missing pages (referenced throughout the app) ────────────────────────────
// /pricing — referenced in Stripe cancel_url and nav links
app.get("/pricing", (_req, res) => res.redirect("/#pricing"));
// /privacy and /legal — convenience redirects to canonical sub-paths
app.get("/privacy", (_req, res) => res.redirect(301, "/legal/privacy"));
// /docs — full API reference page
app.get("/docs", (_req, res) => res.sendFile(path.join(__dirname, '../public/docs.html')));
app.get("/docs/:slug", (_req, res) => res.sendFile(path.join(__dirname, '../public/docs.html')));
app.get("/blog", (_req, res) => res.sendFile(path.join(__dirname, '../public/blog.html')));
app.get("/blog/:slug", (_req, res) => res.sendFile(path.join(__dirname, '../public/blog.html')));
app.get("/sdk", (_req, res) => res.sendFile(path.join(__dirname, '../public/sdk.html')));
// /success — Stripe post-checkout success page
app.get("/success", (_req, res) => {
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
// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({
        ok: false,
        error: "not_found",
        request_id: crypto.randomUUID(),
    });
});
// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
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
    }
    catch { /* non-fatal */ }
}, 24 * 60 * 60 * 1000);
export default app;
//# sourceMappingURL=index.js.map