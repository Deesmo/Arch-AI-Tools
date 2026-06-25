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
- **All API commands run from `api/`** (where `package.json` lives). `npm run
  dev`, `npm run seed`, `npm test`, `npm run build`, and `npm run db:push` all
  work from `api/`. (Historically `dev`/`seed` had a `api/src/...` path bug; the
  scripts were fixed to use `src/...` and the ts-node ESM loader.)
- **`api/.env` auto-loads for the common commands.** `npm run dev`/`npm run seed`
  load it via Node's `--env-file-if-exists=.env`, and the Prisma CLI
  (`db:push`/`generate`) loads it automatically. The app code itself does NOT
  import dotenv, so if you run a script that bypasses those (e.g. `node
  dist/index.js` directly), export the env first: `set -a && . .env && set +a`.
  The local dev `api/.env` is created during setup and git-ignored.
- **`JWT_SECRET` is mandatory** — `api/src/routes/auth.ts` throws on boot if it
  is unset. It lives in `api/.env`.
- **This project is ESM** (`"type":"module"`, `module:ESNext`). Plain `ts-node`
  and `ts-node-dev` cannot load it (`Must use import to load ES Module` /
  `Unknown file extension ".ts"`); that is why `npm run dev`/`seed` invoke
  `node --loader ts-node/esm` instead. The `--experimental-loader` deprecation
  warning it prints is harmless.
- **`prisma migrate deploy` fails from an empty DB** — migration
  `20260313_add_api_key_hash` backfills from an `api_key` column that `0001_init`
  never creates. This is a latent issue in the committed migration history; it is
  left untouched because editing an already-applied migration would change its
  checksum and could break the live Render deploy. For local/dev/CI, use
  `npm run db:push` to sync the current `schema.prisma` (this is the intended dev
  workflow); do not rely on the migration chain locally.
- **Prisma DB columns are snake_case** (e.g. `verify_token`, `email_verified`;
  `totalCalls` is camelCase) — match the actual column names in raw `psql`.

### Start PostgreSQL + Redis (not auto-started)
```
sudo pg_ctlcluster 16 main start          # Postgres on :5432 (db: arch_dev, role arch/arch)
sudo redis-server --daemonize yes --save "" --appendonly no   # Redis on :6379 (optional)
```

### Run / build / test the API (from api/)
```
cd /workspace/api

npm run dev           # dev server w/ hot reload (node --watch + ts-node/esm) → :8787
npm run build         # prisma generate && tsc  (CI type-check: npx tsc --noEmit)
npm start             # node dist/index.js (needs env exported: set -a && . .env && set +a)

npm run db:push       # sync schema.prisma to the DB (fresh/dev DB path; auto-loads .env)
npm run seed          # seed the ~61 tools (auto-loads .env)

# Tests default to the PROD target — override TEST_BASE_URL for local:
TEST_BASE_URL=http://localhost:8787 npm test   # integration + pages tests
```
There is no ESLint config for `api/`; `npx tsc --noEmit` is the lint/type gate.

### Test notes
- `integration.test.js` now passes 13/13 and `pages.test.js` 31/31, both locally
  and against prod. Two things to know:
  - Public `/health` is intentionally minimal (`{ok:true}`); the detailed shape
    (tools count + dependency status) is admin-only by design (see `SECURITY.md`).
    The test validates the public contract always, and the detailed payload only
    when `TEST_ADMIN_KEY` is set (passed as `x-admin-key`).
  - The unauthenticated tool call asserts the x402 `402`. That gate only fires
    when `WALLET_ADDRESS` is set, so the local `api/.env` includes a dummy Base
    address (prod has a real one). Authenticated (Bearer key) calls bypass the
    gate and go through the credit/auth path as normal.
- Run locally with: `TEST_BASE_URL=http://localhost:8787 TEST_ADMIN_KEY=$ADMIN_KEY npm test`

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
