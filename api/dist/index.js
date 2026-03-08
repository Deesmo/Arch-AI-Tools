"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
// Routes
const discovery_1 = __importDefault(require("./routes/discovery"));
const agent_1 = __importDefault(require("./routes/agent"));
const index_1 = __importDefault(require("./routes/tools/index"));
const billing_1 = __importDefault(require("./routes/billing"));
const admin_1 = __importDefault(require("./routes/admin"));
const workflows_1 = __importDefault(require("./routes/workflows"));
const seo_1 = __importDefault(require("./routes/seo"));
const legal_1 = __importDefault(require("./routes/legal"));
const oauth_1 = __importDefault(require("./routes/oauth"));
const signupHtml_1 = require("./assets/signupHtml");
const dashboardHtml_1 = require("./assets/dashboardHtml");
const app = (0, express_1.default)();
// ─── Trust proxy (Render sits behind one) ────────────────────────────────────
app.set("trust proxy", 1);
// ─── Security headers (helmet) ────────────────────────────────────────────────
app.use((0, helmet_1.default)({
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
const globalLimiter = (0, express_rate_limit_1.default)({
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
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
    message: { ok: false, error: "rate_limited", message: "Too many auth attempts. Try again in 15 minutes." },
});
// ─── Middleware ───────────────────────────────────────────────────────────────
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigin, credentials: true }));
app.use((0, morgan_1.default)("combined"));
app.use(globalLimiter);
// Stripe webhook needs raw body — must come before express.json()
app.use("/webhooks/stripe", express_1.default.raw({ type: "application/json" }));
app.use(express_1.default.json({ limit: "10mb" }));
app.use(express_1.default.urlencoded({ extended: true }));
// ─── Request ID ───────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
    req.headers["x-request-id"] = req.headers["x-request-id"] ?? crypto.randomUUID();
    next();
});
// ─── Favicon — redirect to SVG icon ──────────────────────────────────────────
app.get('/favicon.ico', (_req, res) => res.redirect(301, '/arch-icon.svg'));
// ─── Static files (landing page) ─────────────────────────────────────────────
// HTML files: no-cache so browsers always revalidate (prevents stale JS/CSS bugs)
// Assets (images, icons): allow caching
app.use(express_1.default.static(path_1.default.join(__dirname, "../public"), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
        else if (filePath.match(/\.(png|jpg|svg|ico|webp)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));
// ─── og-image.png — serve SVG as image/svg+xml at /og-image.png ──────────────
app.get("/og-image.png", (_req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(path_1.default.join(__dirname, "../public/og-image.svg"));
});
// ─── Routes ───────────────────────────────────────────────────────────────────
// Discovery & health (no auth)
app.use("/", discovery_1.default);
// SEO free tool pages + no-auth API endpoints
app.use("/tools", seo_1.default);
app.use("/v1/tools", seo_1.default); // Free endpoint proxies
// Agent registration & usage (rate limited to prevent brute force)
app.use("/v1/agent", authLimiter, agent_1.default);
// OAuth (rate limited to prevent brute force)
app.use("/oauth", authLimiter, oauth_1.default);
// Tool calls (tier-based rate limiting handled inside toolMiddleware, post-auth)
app.use("/v1/tools", index_1.default);
// Billing
app.use("/v1/billing", billing_1.default);
app.use("/webhooks", billing_1.default);
// Admin
app.use("/v1/admin", admin_1.default);
app.use("/admin", admin_1.default);
// Workflows
app.use("/v1/workflows", workflows_1.default);
// Legal
app.use("/legal", legal_1.default);
// ─── Frontend pages ───────────────────────────────────────────────────────────
app.get("/signup", (_req, res) => res.type("text/html").send(signupHtml_1.SIGNUP_HTML));
app.get("/login", (_req, res) => res.type("text/html").send(signupHtml_1.SIGNUP_HTML));
app.get("/dashboard", (_req, res) => res.type("text/html").send(dashboardHtml_1.DASHBOARD_HTML));
// ─── Missing pages (referenced throughout the app) ────────────────────────────
// /pricing — referenced in Stripe cancel_url and nav links
app.get("/pricing", (_req, res) => res.redirect("/#pricing"));
// /docs — referenced in nav, dashboard, and agent registration
app.get("/docs", (_req, res) => res.redirect("https://github.com/Deesmo/Arch-AI-Tools#readme"));
app.get("/docs/:path", (_req, res) => res.redirect("https://github.com/Deesmo/Arch-AI-Tools#readme"));
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
        message: config_1.config.nodeEnv === "development" ? err.message : "Internal server error",
        request_id: crypto.randomUUID(),
    });
});
// ─── Start ────────────────────────────────────────────────────────────────────
// Startup guard — fail fast if ADMIN_KEY is insecure
if (config_1.config.nodeEnv === "production" && (!process.env.ADMIN_KEY || process.env.ADMIN_KEY === "changeme")) {
    console.error("FATAL: ADMIN_KEY must be set to a secure value in production. Exiting.");
    process.exit(1);
}
app.listen(config_1.config.port, () => {
    console.log(`⚡ Arch Tools API v1.5.0 running on port ${config_1.config.port}`);
    console.log(`   ENV: ${config_1.config.nodeEnv}`);
    console.log(`   Site: ${config_1.config.publicSiteUrl}`);
});
// Daily cleanup of expired OAuth records
setInterval(async () => {
    try {
        const { cleanupExpiredOAuthRecords } = await Promise.resolve().then(() => __importStar(require("./lib/systemJobs")));
        await cleanupExpiredOAuthRecords();
    }
    catch { /* non-fatal */ }
}, 24 * 60 * 60 * 1000);
exports.default = app;
//# sourceMappingURL=index.js.map