# Security Notes — Arch AI Tools API

## Known Gaps & Migration Plans

### 1. API Key Hashing

**Current state:** API keys (`arch_*`) are stored in plaintext in the `Agent.apiKey` field.

**Risk:** If the database is compromised, all API keys are exposed immediately.

**Migration plan (safe, zero-downtime):**

1. **Schema change** — Add a nullable hash column to Prisma schema:
   ```prisma
   model Agent {
     // ... existing fields ...
     apiKeyHash String? @unique  // nullable during migration period
   }
   ```

2. **Deploy new schema** — Run `npx prisma migrate dev --name add-api-key-hash`.

3. **Migration script** — Hash all existing keys and populate `apiKeyHash`:
   ```typescript
   import crypto from "crypto";
   import { prisma } from "./src/lib/prisma";

   async function migrateKeys() {
     const agents = await prisma.agent.findMany({ where: { apiKeyHash: null } });
     for (const agent of agents) {
       const hash = crypto.createHash("sha256").update(agent.apiKey).digest("hex");
       await prisma.agent.update({ where: { id: agent.id }, data: { apiKeyHash: hash } });
     }
     console.log(`Migrated ${agents.length} agents`);
   }
   migrateKeys();
   ```

4. **Auth middleware** — Update to try hash lookup first, fall back to plaintext for
   backward compatibility, then hash-and-save on plaintext hit:
   ```typescript
   const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
   agent = await prisma.agent.findUnique({ where: { apiKeyHash: hash } });
   if (!agent) {
     // Plaintext fallback (migration period only)
     agent = await prisma.agent.findUnique({ where: { apiKey } });
     if (agent) {
       // Opportunistically migrate this key
       await prisma.agent.update({ where: { id: agent.id }, data: { apiKeyHash: hash } });
     }
   }
   ```

5. **After migration window** — Once all keys have `apiKeyHash` populated, drop the
   plaintext `apiKey` column and remove the fallback lookup.

**Why not done now:** Existing users' plaintext keys cannot be recovered post-hashing.
A migration window is required so the transition is seamless.

---

### 2. Admin Key

`ADMIN_KEY` defaults to `"changeme"` in development. A startup guard in `api/src/index.ts`
prevents the server from starting in production with this default (or with `ADMIN_KEY` unset).

**Action required:** Set `ADMIN_KEY` to a strong random value in your Render environment variables.

---

### 3. CORS

`CORS_ORIGIN` defaults to `"https://archtools.dev"`. Override via the `CORS_ORIGIN` environment
variable if you need to allow additional origins.

---

### 4. SSRF Protection

All tool endpoints that accept user-supplied URLs validate them through `api/src/lib/ssrf.ts`
before making outbound HTTP requests. This blocks:
- Private IP ranges (RFC 1918, link-local, loopback)
- Cloud metadata endpoints (169.254.169.254, metadata.google.internal, etc.)
- Render internal ranges (100.64.x.x)
- DNS rebinding (IPs are resolved and checked post-DNS-lookup)

---

### 5. OAuth Timing Attack

The OAuth `/token` endpoint uses `crypto.timingSafeEqual` to compare `client_secret` values,
preventing timing-based secret enumeration attacks.

---

### Reporting Security Issues

Please email security issues to the repository owner. Do not open public GitHub issues for
vulnerabilities.
