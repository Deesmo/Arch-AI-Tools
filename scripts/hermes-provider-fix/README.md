# hermes-provider-fix

Operator utility for a **local Hermes Agent install** (Nous Research's agent, the thing
behind Hermes Desktop). It has nothing to do with the Arch Tools API — it lives here
because this is where our operator scripts live.

It answers one question: *why does Hermes keep asking for OpenRouter credits when
Anthropic, OpenAI, xAI and Gemini keys are already configured?*

## The problem

Hermes picks a provider through `hermes_cli.auth.resolve_provider()`. When
`model.provider` is not set in `~/.hermes/config.yaml`, that function walks this
precedence order:

| # | Check | Result |
|---|-------|--------|
| 1 | Explicit CLI `--api-key` / `--base-url` | **OpenRouter** |
| 2 | `model.provider` from `config.yaml` | that provider |
| 3 | `OPENAI_API_KEY` **or** `OPENROUTER_API_KEY` present | **OpenRouter** |
| 4 | OpenRouter credential in `auth.json` | **OpenRouter** |
| 5 | Any other provider's API key (Anthropic, Gemini, xAI, …) | that provider |
| 6 | Logged-in OAuth provider from `auth.json` | that provider |

Step 3 fires before step 5. An `OPENAI_API_KEY` sitting in `~/.hermes/.env` is
therefore enough to route **every** request to `openrouter.ai` — and Hermes sends that
OpenAI key as the OpenRouter bearer token. The Anthropic, Gemini and xAI keys in the
same file are never reached, and OpenRouter has no balance associated with an OpenAI
key, so it reports no credit.

Reproduced against `hermes-agent==0.19.0` with four direct keys and no OpenRouter key
at all:

```
resolve_requested_provider()  -> 'auto'
resolve_provider('auto')      -> 'openrouter'
resolve_runtime_provider()    -> provider=openrouter
                                 base_url=https://openrouter.ai/api/v1
                                 api_key=<the OPENAI_API_KEY>
```

Two related traps:

- **`model.provider: openai` does not mean the OpenAI API.** `openai` is an alias for
  `openrouter` in `hermes_cli.providers.ALIASES`, and the resolver separately rejects it
  as an unknown provider. The direct OpenAI provider is named **`openai-api`**.
- **Auxiliary slots are pinned independently.** `auxiliary.<task>.provider: openrouter`
  (vision, web_extract, compression, title_generation, …), `delegation.provider`, and
  `fallback_providers` keep billing OpenRouter even after the main chat model is direct.

## The fix

Set `model.provider` explicitly. That satisfies step 2, so steps 3 and 4 never run and
the OpenRouter key (or the absence of one) stops mattering.

| Vendor | Provider id | Key env var |
|--------|-------------|-------------|
| Anthropic / Claude | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai-api` | `OPENAI_API_KEY` |
| xAI / Grok | `xai` | `XAI_API_KEY` |
| Google / Gemini | `gemini` | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |

## Usage

Run it with the interpreter that has Hermes installed (it finds that itself in the
common layouts, but being explicit never hurts):

```bash
# 1. Look, change nothing
python3 hermes_provider_fix.py

# 2. Also check which keys actually work, against each provider's own API
python3 hermes_provider_fix.py --verify

# 3. Apply the fix (a dry-run plan is printed by every read-only invocation first)
python3 hermes_provider_fix.py --verify --apply

# Force a specific provider instead of the best verified one
python3 hermes_provider_fix.py --apply --provider gemini
```

If it cannot find Hermes, point it at the venv directly:

```bash
~/.hermes/hermes-agent/venv/bin/python hermes_provider_fix.py --verify
```

Exit codes: `0` clean or applied, `1` blockers found (nothing written), `2` could not
run or could not pick a provider.

## What it does

**Diagnosis** runs inside the Hermes interpreter and calls Hermes' own
`resolve_requested_provider()` / `resolve_runtime_provider()`, so the reported routing is
what Hermes will actually do, not a re-implementation of its rules. On top of that it
scans for every other path that reaches OpenRouter: `model.base_url`, per-task
`auxiliary.*` overrides and their `fallback_chain`s, `delegation.provider`,
`fallback_providers` / legacy `fallback_model`, `OPENROUTER_API_KEY` /
`OPENAI_BASE_URL` / `OPENROUTER_BASE_URL` in the environment, and OpenRouter
credentials in `auth.json`.

**`--verify`** makes one cheap authenticated `GET` per provider against its own model
catalogue and reports works / rejected / no-credit. xAI and Gemini answer a bad key with
HTTP 400 rather than 401, so their response bodies are inspected too.

**`--apply`** backs up `config.yaml` to a timestamped file, then writes exclusively
through `hermes config set` / `hermes config unset` — Hermes' own YAML-safe path, never a
hand-rolled YAML edit. It sets `model.provider`, translates the model id to its native
form with Hermes' `normalize_model_for_provider()` (falling back to
`get_default_model_for_provider()` when the configured id belongs to another vendor),
clears the OpenRouter overrides it found, and finally re-runs the resolver to prove the
new routing.

Deliberate limits:

- **It never edits `~/.hermes/.env`.** Key material is yours to manage; env-var problems
  are reported and left alone.
- **A mixed fallback chain is left alone.** Removing a list that contains both OpenRouter
  and direct entries would discard the good ones, so that case is reported for a manual
  edit. A chain that is entirely OpenRouter is removed.
- **API key values are never printed, logged or written** — only the names of the
  environment variables holding them.

## After applying

```bash
hermes doctor      # cross-check
hermes fallback    # optional: add your other working keys as fallbacks
hermes             # start a session
```

To roll back, restore the backup the tool printed:

```bash
cp ~/.hermes/config.yaml.bak-provider-fix-<timestamp> ~/.hermes/config.yaml
```
