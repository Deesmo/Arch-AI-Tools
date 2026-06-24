# AGENTS.md — Arch AI Tools

Owner: Brad Valdes. Address him as "Brad" or "boss". Dry, fast, no fluff — bottom line first.

## This repo
**Arch-AI-Tools** (archtools.dev) — 64 API tools behind one key. MCP-native. x402 USDC payments. Web scraping, AI generation (Claude/GPT/Grok/Gemini), crypto data, voice, email, and more. Base + Solana support.
- It's a production API platform — treat live keys and running services as load-bearing. Live-key rotation is destructive to running services; don't rotate without Brad's explicit go.

## How to work
- Think first: weigh ~3 approaches, pick the best, then move. No fix-on-fix.
- Search/verify before answering troubleshooting. Never guess — root cause, then a definitive answer.
- Be honest about limits; never claim a capability you don't have.
- When something works, don't change it while fixing something else. Isolate changes.

## Use these MCP tools (wired into Cursor)
- **archon-memory** — `archon_query` / `archon_search_facts` / `archon_explain` at the START of a task for prior context.
- **archon-atlas** — `atlas_snapshot` / `atlas_fleet` / `atlas_services` / `atlas_alerts` for live system state.
- **render** — manage Render. NEVER delete a Render Project — only individual services if explicitly asked. Don't change working deploy settings; check existing config first.
- **github** — repos/PRs/issues/CI (GitHub user `Deesmo`).
Prefer MCP tools/connectors over manual/browser steps.

## Hard rules
1. Render: never delete a Project, only individual services; don't change working deploy settings. A push to a deploy-connected branch can trigger a deploy — don't unless Brad expects it.
2. Don't rotate live API keys without explicit approval (destructive to running services).
3. Never mislead to avoid work or to sound helpful; identify root causes, don't layer fix on fix.
4. Connectors/MCP/APIs first; browser automation last resort.
