import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import path from "path";
import { config } from "./config";

// Routes
import discoveryRouter from "./routes/discovery";
import agentRouter from "./routes/agent";
import toolsRouter from "./routes/tools/index";
import billingRouter from "./routes/billing";
import adminRouter from "./routes/admin";
import workflowsRouter from "./routes/workflows";
import seoRouter from "./routes/seo";
import legalRouter from "./routes/legal";
import oauthRouter from "./routes/oauth";

const app = express();

// ─── Trust proxy (Render sits behind one) ────────────────────────────────────
app.set("trust proxy", 1);

// ─── Security headers (helmet) ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],  // landing page inline scripts
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://archtools.dev", "https://arch-ai-tools.onrender.com"],
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(morgan("combined"));
app.use(globalLimiter);

// Stripe webhook needs raw body — must come before express.json()
app.use("/webhooks/stripe", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Request ID ───────────────────────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.headers["x-request-id"] = req.headers["x-request-id"] ?? crypto.randomUUID();
  next();
});

// ─── Static files (landing page) ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "../public")));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Discovery & health (no auth)
app.use("/", discoveryRouter);

// SEO free tool pages + no-auth API endpoints
app.use("/tools", seoRouter);
app.use("/v1/tools", seoRouter);  // Free endpoint proxies

// Agent registration & usage (rate limited to prevent brute force)
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



// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: "not_found",
    request_id: crypto.randomUUID(),
  });
});

// ─── Error handler ───────────────────────────────────────────────────────────
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
app.listen(config.port, () => {
  console.log(`⚡ Arch Tools API v1.5.0 running on port ${config.port}`);
  console.log(`   ENV: ${config.nodeEnv}`);
  console.log(`   Site: ${config.publicSiteUrl}`);
});

export default app;
