"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
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
const app = (0, express_1.default)();
// ─── Trust proxy (Render sits behind one) ────────────────────────────────────
app.set("trust proxy", 1);
// ─── Middleware ───────────────────────────────────────────────────────────────
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigin, credentials: true }));
app.use((0, morgan_1.default)("combined"));
// Stripe webhook needs raw body — must come before express.json()
app.use("/webhooks/stripe", express_1.default.raw({ type: "application/json" }));
app.use(express_1.default.json({ limit: "10mb" }));
app.use(express_1.default.urlencoded({ extended: true }));
// ─── Request ID ───────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
    req.headers["x-request-id"] = req.headers["x-request-id"] ?? crypto.randomUUID();
    next();
});
// ─── Static files (landing page) ─────────────────────────────────────────────
app.use(express_1.default.static(path_1.default.join(__dirname, "../public")));
// ─── Routes ───────────────────────────────────────────────────────────────────
// Discovery & health (no auth)
app.use("/", discovery_1.default);
// SEO free tool pages + no-auth API endpoints
app.use("/tools", seo_1.default);
app.use("/v1/tools", seo_1.default); // Free endpoint proxies
// Agent registration & usage
app.use("/v1/agent", agent_1.default);
// Tool calls (auth via middleware in each route)
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
// OAuth 2.0 (Claude Connector + future integrations)
app.use("/oauth", oauth_1.default);
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
app.listen(config_1.config.port, () => {
    console.log(`⚡ Arch Tools API v1.5.0 running on port ${config_1.config.port}`);
    console.log(`   ENV: ${config_1.config.nodeEnv}`);
    console.log(`   Site: ${config_1.config.publicSiteUrl}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map