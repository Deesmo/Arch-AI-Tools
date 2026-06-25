# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
Monorepo for **Arch AI Tools** (archtools.dev). The deployable product is the
`api/` service — an Express + Prisma (PostgreSQL) server that hosts ~61 API
tools, API-key auth, credit billing (Stripe), and x402 micropayments. `web/`
(Next.js marketing site), `mcp/` (MCP wrapper that proxies the hosted API), and
`sdk/` (client libraries) are clients/libraries, not required to run the API.

The cloud VM is pre-provisioned (PostgreSQL 16 + Redis installed, `api/`
dependencies + Prisma client installed via the startup update script). The
notes below cover only the non-obvious bits.

### Critical gotchas
- **No dotenv auto-loading.** `api/src/` reads `process.env` directly; nothing
  loads `api/.env`. You MUST export the env before running anything:
  `cd api && set -a && . .env && set +a`. The local dev `api/.env` is created
  during setup and git-ignored (it is not committed).
- **`JWT_SECRET` is mandatory** — `api/src/routes/auth.ts` throws on boot if it
  is unset. It lives in `api/.env`.
- **npm scripts assume cwd = repo root**, not `api/`. `package.json` `dev`/`seed`
  use paths like `api/src/index.ts`, so `npm run dev`/`npm run seed` from inside
  `api/` resolve to `api/api/src/...` and fail. The integration/page tests are
  likewise run from the repo root (see `.github/workflows/test.yml`).
- **`ts-node`/`ts-node-dev` cannot load this project directly.** The package is
  ESM (`"type":"module"`, `module:ESNext`) and those runners error
  (`Must use import to load ES Module` / `Unknown file extension ".ts"`). Run the
  dev server with the ts-node ESM loader instead (see below) or run the compiled
  `dist/`.
- **`prisma migrate deploy` fails from an empty DB** — migration
  `20260313_add_api_key_hash` references an `api_key` column that `0001_init`
  never creates. For local/dev, use `prisma db push` (the `db:push` script) to
  sync the current `schema.prisma`; do not rely on the migration chain locally.
- **Prisma DB columns are snake_case** (e.g. `verify_token`, `email_verified`,
  `totalCalls` is camelCase) — match the actual column names in raw `psql`.

### Start PostgreSQL + Redis (not auto-started)
```
sudo pg_ctlcluster 16 main start          # Postgres on :5432 (db: arch_dev, role arch/arch)
sudo redis-server --daemonize yes --save "" --appendonly no   # Redis on :6379 (optional)
```

### Run / build / test the API (from the repo ROOT, env loaded)
```
cd /workspace/api && set -a && . .env && set +a   # load env (do this first)

# Dev server (hot-loaded TS via ts-node ESM loader) — run from api/ so node resolves ts-node:
TS_NODE_TRANSPILE_ONLY=1 node --loader ts-node/esm src/index.ts   # → http://localhost:8787

# Build + production-style run:
npm run build         # prisma generate && tsc  (also the CI type-check: npx tsc --noEmit)
npm start             # node dist/index.js

# Seed the ~61 tools (compiled path is most reliable):
node /workspace/api/dist/seed.js     # or: npx prisma db push first if schema changed

# Tests (run from repo root; default target is PROD — override for local):
TEST_BASE_URL=http://localhost:8787 node api/tests/integration.test.js
TEST_BASE_URL=http://localhost:8787 node api/tests/pages.test.js
```
There is no ESLint config for `api/`; `npx tsc --noEmit` is the lint/type gate.

### Known local test caveats (not setup failures)
- `integration.test.js`: 2 of 12 checks fail locally by design —
  (1) public `/health` returns minimal `{ok:true}` unless the `x-admin-key`
  header matches `ADMIN_KEY` (detailed shape with `tools`/`dependencies` is
  admin-only); (2) the unauthenticated tool call returns `401` instead of `402`
  because no x402 wallet (`WALLET_ADDRESS`) is configured. Both pass against
  production where those are set. `pages.test.js` passes 31/31.

### Verifying a new account locally (no email provider configured)
Signups gate 100 credits behind email verification. Without an email provider,
grab the token from the DB and hit the verify endpoint:
```
TOKEN=$(sudo -u postgres psql -d arch_dev -tA -c "SELECT verify_token FROM \"Agent\" WHERE email='you@example.com';")
curl "http://localhost:8787/v1/agent/verify-email?token=$TOKEN"   # activates pending credits
```

### Optional API keys
Most "AI" tools (`ai-generate`, `summarize`, etc.) need `ANTHROPIC_API_KEY` and
other per-tool keys (`OPENAI_API_KEY`, `TAVILY_API_KEY`, `STRIPE_SECRET_KEY`,
…). The credit/auth core and deterministic tools (`generate-hash`,
`generate-uuid`, `transform-text`, etc.) work with no external keys. See
`api/.env.example` for the full list.
