# Arch Tools — Deployment Checklist

## SAFETY RULES (non-negotiable)
- Do NOT delete Render projects — only individual services
- Do NOT remove existing API endpoints
- Do NOT change working Render deploy settings without checking existing config
- Deploy changes from a separate branch before merging to main
- All upgrades must be backward compatible

---

## OPTION 1: Render Blueprint (recommended)

Push `render.yaml` to your GitHub repo and connect it in Render Dashboard.
Render auto-creates: API service + PostgreSQL + MCP SSE server + Cron job.

After Render creates everything:
1. Go to each service → Environment → manually set:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `ANTHROPIC_API_KEY`
   - `SENTRY_DSN` (optional)
2. Open the API service shell and run: `npm run seed`
3. Verify: `GET /health` should return `db: "connected"`

---

## OPTION 2: Manual Setup (step by step)

### Step 1: Create PostgreSQL Database
1. Render Dashboard → New → PostgreSQL
2. Name: `arch-tools-db`
3. Plan: Starter ($7/mo)
4. Region: Oregon
5. Copy the **Internal Database URL** (for services in same region)

### Step 2: Create API Web Service
1. Render Dashboard → New → Web Service
2. Connect your GitHub repo (Deesmo/arch-tools or whatever you name it)
3. Settings:
   - **Name:** `arch-tools-api`
   - **Root Directory:** `api`
   - **Runtime:** Node
   - **Plan:** Starter ($7/mo — always on)
   - **Build Command:** `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
   - **Start Command:** `npm run start`
   - **Health Check Path:** `/health`

4. Environment Variables:
   ```
   NODE_ENV=production
   PORT=10000
   CORS_ORIGIN=https://archtools.dev,https://www.archtools.dev
   DATABASE_URL=<paste from Step 1>
   ADMIN_KEY=<generate a long random string>
   FREE_MONTHLY_CREDITS=100
   RATE_LIMIT_FREE=60
   RATE_LIMIT_PRO=240
   RATE_LIMIT_BUSINESS=1200
   STRIPE_SECRET_KEY=<from Stripe Dashboard>
   STRIPE_WEBHOOK_SECRET=<from Stripe webhook setup — Step 5>
   ANTHROPIC_API_KEY=<your Anthropic key>
   SENTRY_DSN=<from Sentry — optional>
   ```

5. Deploy and wait for it to go green.

### Step 3: Seed Tools
1. In Render → arch-tools-api → Shell
2. Run: `npm run seed`
3. Verify: `curl https://arch-tools-api.onrender.com/v1/tools`

### Step 4: Create MCP SSE Service (optional)
1. Render Dashboard → New → Web Service
2. Settings:
   - **Name:** `arch-tools-mcp`
   - **Root Directory:** `mcp`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start:sse`
   - **Health Check Path:** `/health`
3. Environment:
   ```
   ARCH_API_BASE_URL=https://arch-tools-api.onrender.com
   ARCH_API_KEY=<register an agent and use its key>
   MCP_TRANSPORT=sse
   MCP_SSE_PORT=10000
   ```

### Step 5: Set Up Stripe Webhook
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://arch-tools-api.onrender.com/stripe/webhook`
3. Events to listen for: `checkout.session.completed`
4. Copy the **Signing secret** → paste as `STRIPE_WEBHOOK_SECRET` in Render

### Step 6: Create Monthly Cron Job
1. Render Dashboard → New → Cron Job
2. Settings:
   - **Name:** `arch-tools-credit-refresh`
   - **Root Directory:** `api`
   - **Build Command:** `npm install && npx prisma generate`
   - **Command:** `npm run refresh-credits`
   - **Schedule:** `0 0 1 * *` (1st of month, midnight UTC)
3. Environment:
   ```
   DATABASE_URL=<same as API service>
   FREE_MONTHLY_CREDITS=100
   ```

### Step 7: Configure DNS (Cloudflare)
1. Cloudflare → archtools.dev → DNS
2. Add CNAME: `@` → `arch-tools-api.onrender.com` (Proxied)
3. Add CNAME: `www` → `arch-tools-api.onrender.com` (Proxied)
4. In Render → arch-tools-api → Settings → Custom Domain → add `archtools.dev`

### Step 8: Verify Everything
```bash
# Health check
curl https://archtools.dev/health

# List tools
curl https://archtools.dev/v1/tools

# Register agent
curl -X POST https://archtools.dev/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"test-agent","email":"test@example.com"}'

# Use the returned api_key to call a tool
curl -X POST https://archtools.dev/v1/tools/generate-hash \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{"algorithm":"sha256","input":"hello"}'
```

---

## Post-Deploy Checklist

- [ ] `/health` returns `db: "connected"` with tool count
- [ ] `/v1/tools` returns 8 tools
- [ ] Agent registration works (with email)
- [ ] Tool invocation works and debits credits
- [ ] Stripe checkout creates session with agent_id
- [ ] Stripe webhook grants credits (test with Stripe CLI)
- [ ] MCP SSE server connects and lists tools
- [ ] OG image deployed at archtools.dev/og-image.png
- [ ] x402 discovery at /.well-known/x402
- [ ] Submit to PulseMCP (pulsemcp.com/submit)
- [ ] Submit PR to awesome-x402
- [ ] Contact Adam Jones for Anthropic MCP Registry
- [ ] Set up Sentry alerts for 500 errors
- [ ] Archive old Stripe products with "Arch AI Tools —" naming

## Ghost Tools
The MCP server dynamically pulls from `GET /v1/tools`.
Only the 8 seeded tools appear — the 4 ghost tools
(html_to_pdf, screenshot_url, validate_email, ai_summarize)
will NOT be registered and stop appearing automatically.


## DX Headers (Recommended)
API responses from `/v1/tools/:tool` now include:
- `X-Request-Id`
- `X-Credits-Used`
- `X-Credits-Remaining`
- `X-Tool-Cache-Hit`

## CORS
- In production, if `CORS_ORIGIN` is not set, API will only allow:
  - https://archtools.dev
  - https://www.archtools.dev
- For local dev, leave `NODE_ENV` unset or not `production` to allow all origins.


## Enterprise Observability (optional but recommended)
- Ensure `METRICS_API_KEY` is set (required for `/v1/metrics` and can also be used for admin endpoints if `ADMIN_API_KEY` is unset).
- Optional: set `ADMIN_API_KEY` for admin routes (`/v1/admin/*`).

## Daily Usage Rollups + Retention (recommended for scale)
- Add the Render Cron job:
  - Schedule: `20 0 * * *` (00:20 UTC daily)
  - Command: `npm run rollup-daily`
- Set retention env vars on the API service (or cron service env):
  - `LOG_RETENTION_DAYS=30` (raw request logs)
  - `ROLLUP_RETENTION_DAYS=365` (daily aggregates)
  - `ROLLUP_DAYS_BACK=3` (captures late-arriving logs)
- Billing endpoints automatically use rollups for windows >= 3 days unless `USE_ROLLUPS_FOR_BILLING=false`.

### Run rollups on-demand (no cron needed for testing)
- In the Admin UI at `/admin/logs` → **Billing** tab, you can click **Run rollup now**.
- This calls `POST /v1/admin/rollup/run` (admin-key protected) and is useful immediately after deploy.

## Very High Volume (optional)
- Performance indexes are included via migration `0007_perf_indexes` (including a BRIN index on `createdAt`).
- If you expect **millions+** of request logs, consider Postgres partitioning:
  - See `api/prisma/partitioning/README.md`
  - SQL template: `api/prisma/partitioning/postgres_partitioning.sql`
