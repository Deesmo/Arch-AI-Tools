# Arch Tools — Platform v1.0

Production-ready API platform for developers and AI agents.

**Live:** archtools.dev  
**API:** archtools.dev  
**Owner:** Arch Enterprises LLC

## What's Included

### API Server (`api/`)
- **8 fully implemented tools** (no stubs) with JSON Schema validation
- **Agent auth** — email-based registration, hashed API keys, key rotation
- **Credit system** — balance tracking, ledger, Stripe checkout + webhooks
- **Plan-based rate limiting** — free/pro/business tiers with cached limiters
- **API versioning** — all endpoints under `/v1/` with legacy backward compat
- **Sentry integration** — error tracking and performance monitoring
- **Stripe checkout** — creates sessions with agent_id metadata for automatic credit grants
- **Auto plan upgrade** — purchasing Pro/Business pack auto-upgrades agent plan + rate limits
- **Dashboard API** — daily usage charts, tool breakdown, key management
- **Monthly credit refresh** — cron-ready script for free-tier monthly grants

### MCP Server (`mcp/`)
- **Dual transport** — Stdio (local CLI) and SSE (web/hosted agents)
- **Dynamic discovery** — pulls tools from API, no hardcoded manifest
- **Ready for directory submissions** — PulseMCP, Anthropic Registry

### Infrastructure
- **render.yaml** — full Render Blueprint (API + DB + MCP + Cron)
- **Cloudflare-ready** — CORS configured for archtools.dev
- **x402 discovery** — `/.well-known/x402` endpoint for agent ecosystem

## Stack

- Node.js + TypeScript + Express
- PostgreSQL via Prisma ORM (Render)
- Stripe (payments + webhooks)
- Anthropic Claude API (ai-generate tool)
- Sentry (error tracking)
- SHA256 hashed API keys
- AJV schema validation

## Quick Start (local)

```bash
cd api
cp .env.example .env   # Fill in DATABASE_URL, ADMIN_KEY, ANTHROPIC_API_KEY
npm install
npx prisma migrate dev
npm run seed
npm run dev
```

Server: `http://localhost:8787`

## API Reference

### Public
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API info + endpoint list |
| `/health` | GET | Health + DB + stats |
| `/v1/tools` | GET | List all tools with schemas |
| `/.well-known/x402` | GET | x402 agent discovery |

### Agent (requires Bearer API key)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/agent/register` | POST | Register (email + name) |
| `/v1/agent/usage` | GET | Credit balance + call stats |
| `/v1/agent/dashboard` | GET | Charts + tool breakdown |
| `/v1/agent/keys` | POST | Generate additional API key |
| `/v1/agent/keys/:prefix` | DELETE | Revoke a key |
| `/v1/tools/me` | GET | Tools with plan context |
| `/v1/tools/:toolName` | POST | Execute any tool |
| `/v1/checkout` | POST | Create Stripe checkout |

### Admin (requires X-Admin-Key)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/publish-tool` | POST | Register/update a tool |
| `/v1/tools/:name` | DELETE | Deactivate a tool |
| `/v1/agent/:id/upgrade` | POST | Change agent plan |

### Webhooks
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stripe/webhook` | POST | Stripe → credit grants |

## Built-in Tools

| Tool | Credits | Category | Status |
|------|---------|----------|--------|
| validate-data | 1 | data | Full (AJV) |
| generate-hash | 1 | security | Full (sha256/512/md5/sha1) |
| qr-code | 2 | media | Full (PNG + SVG) |
| convert-format | 2 | data | Full (JSON/YAML/CSV) |
| transform-text | 3 | text | Full (10 modes) |
| extract-metadata | 3 | data | Full (text + URL/OG) |
| web-scrape | 5 | web | Full (SSRF protected) |
| ai-generate | 20 | ai | Full (Claude API) |

## Security

- API keys stored as SHA256 hashes (never plaintext)
- Registration rate-limited (5/IP/hour)
- Email deduplication prevents credit farming
- Stripe webhook idempotency (no duplicate grants)
- SSRF protection on web-scrape (blocked IPs/hosts)
- Plan self-declaration removed (admin-only upgrades)
- Tool input validated against JSON Schemas
- Helmet security headers
- CORS restricted to archtools.dev

## Legal

The API serves **template** legal documents to keep your public launch coherent:

- `GET /legal/terms`
- `GET /legal/privacy`

Have counsel review before a major public launch.

## OpenAPI

`GET /openapi.json` returns a minimal OpenAPI 3 spec for quick client generation and improved trust.

## Render Deployment

See `DEPLOYMENT_CHECKLIST.md` for step-by-step instructions.
Or use the Blueprint: push `render.yaml` to your repo and Render auto-deploys.


## Legal & Policies

- `/legal` (index)
- `/legal/terms`
- `/legal/privacy`
- `/legal/aup`
- `/legal/refund`
- `/legal/security`
- `/legal/retention`
- `/legal/subprocessors`

> Templates included for launch consistency. Have counsel review for your specific business.


## Ops: Metrics (v13)
If you set `METRICS_API_KEY` in the API service env, you can query a lightweight in-memory metrics snapshot at `GET /v1/metrics` using header `x-metrics-key: <your key>`.
