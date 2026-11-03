/**
 * Provider credit health — switch a tool off when the paid provider behind it
 * has run out of credit, and switch it back on when credit returns.
 *
 * Why: on 2026-11-02 OpenAI and Runway had been out of credit for days and
 * CoinGecko's subscription had lapsed, with no alert; every call to their tools
 * failed (and x402 payers paid for the failure). Now:
 *
 * - A tool is gated BEFORE payment/charging (toolMiddleware runs providerGate
 *   first), answering 503 tool_temporarily_unavailable + Retry-After.
 * - A provider is marked exhausted only on a definite "no credit" answer —
 *   402, an explicit quota/credit message, or a balance below the published
 *   price of one call (MIN_BALANCE) — never on a plain rate limit, a network
 *   error or a guessed balance threshold.
 * - Recovery: an active probe every 30 minutes while exhausted (6 hours while
 *   healthy). OpenAI: a 1-token chat call. Balance providers: the balance rose
 *   above what it was when the provider ran dry (a top-up happened).
 * - Every change of state posts one Discord alert (lib/alert.ts).
 *
 * In-memory per process; a restart starts optimistic and the next definite
 * failure or probe re-establishes the state.
 */
import { sendSecurityAlert } from "./alert.js";

export type ProviderName = "openai" | "runway" | "elevenlabs" | "removebg" | "hunter" | "stability";

/** Tools that depend on paid providers. A tool is off only when ALL its providers are exhausted (fallbacks). */
export const TOOL_PROVIDERS: Record<string, ProviderName[]> = {
  "design-create": ["openai", "stability"],
  "generate-image": ["openai", "stability"],
  "transcribe-audio": ["openai"],
  "video-generate": ["runway"],
  "text-to-speech": ["elevenlabs"],
  "image-remove-bg": ["removebg"],
  "email-find": ["hunter"],
};

/**
 * Smallest balance that can pay for ONE call, from the provider's published price
 * (not a guess). A probe reading below it counts as out of credit; providers not
 * listed are out only at 0. Runway: video-generate runs gen4.5 at 12 credits per
 * second with a 5 s minimum = 60 credits (docs.dev.runwayml.com/guides/pricing).
 */
export const MIN_BALANCE: Partial<Record<ProviderName, number>> = { runway: 60 };

const PROVIDER_LABEL: Record<ProviderName, string> = {
  openai: "OpenAI", runway: "Runway", elevenlabs: "ElevenLabs", removebg: "remove.bg", hunter: "Hunter", stability: "Stability AI",
};

interface ProviderState {
  exhausted: boolean;
  since?: string;
  detail?: string;
  balance?: number;
  balanceAtExhaustion?: number;
  lastCheck?: string;
  lastCheckOk?: boolean;
}

const state = new Map<ProviderName, ProviderState>();
const get = (p: ProviderName): ProviderState => {
  let s = state.get(p);
  if (!s) { s = { exhausted: false }; state.set(p, s); }
  return s;
};

// Runway: "You do not have enough credits"; OpenAI: insufficient_quota /
// credit_balance_exhausted / "no credits remaining"; Google: "exceeded your current quota".
const CREDIT_MESSAGE = /insufficient[_ ]?(quota|credits?|balance|funds)|credit[_ ]balance[_ ]exhausted|(?:not|n't)\s+(?:have\s+)?enough\s+credits|no credits remaining|out of credits|quota[_ ]exceeded|exceeded your current quota|billing[_ ]hard[_ ]limit/i;

/** True only for a definite "no credit / quota used up" answer (not a plain rate limit). */
export function isCreditExhaustion(status: number, body: string): boolean {
  if (status === 402) return true;
  if (status >= 400 && status < 500 && CREDIT_MESSAGE.test(body)) return true;
  return false;
}

function toolsFor(p: ProviderName): string[] {
  return Object.entries(TOOL_PROVIDERS).filter(([, ps]) => ps.includes(p)).map(([t]) => t);
}

function markExhausted(p: ProviderName, detail: string, balance?: number): void {
  const s = get(p);
  if (s.exhausted) return;
  s.exhausted = true;
  s.since = new Date().toISOString();
  s.detail = detail.slice(0, 300);
  // The baseline a top-up must beat. Only a fresh probe reading counts: s.balance is from
  // the last healthy probe (up to 6h old, and higher after the spend that ran it dry), and
  // a top-up landing below it would never clear the breaker. Unknown here → the next probe
  // reading fills it in (noteProviderResponse probes right away).
  s.balanceAtExhaustion = balance;
  const off = toolsFor(p).filter((t) => unavailableProviders(t));
  console.error(`[provider-health] ${PROVIDER_LABEL[p]} exhausted: ${s.detail}`);
  sendSecurityAlert({
    type: "provider_exhausted",
    dedupeKey: `provider_exhausted:${p}`,
    severity: "critical",
    title: `${PROVIDER_LABEL[p]} is out of credit`,
    detail: `${s.detail}\nSwitched off until it is topped up: ${off.length ? off.join(", ") : "(none — a fallback provider is still up)"}.`,
    fields: { provider: p, since: s.since },
  });
}

function markRecovered(p: ProviderName, why: string): void {
  const s = get(p);
  if (!s.exhausted) return;
  const since = s.since;
  s.exhausted = false;
  s.since = undefined;
  s.detail = undefined;
  s.balanceAtExhaustion = undefined;
  console.log(`[provider-health] ${PROVIDER_LABEL[p]} recovered: ${why}`);
  sendSecurityAlert({
    type: "provider_recovered",
    dedupeKey: `provider_recovered:${p}`,
    severity: "info",
    title: `${PROVIDER_LABEL[p]} has credit again`,
    detail: `${why}\nBack on: ${toolsFor(p).join(", ")}. Was out since ${since}.`,
    fields: { provider: p },
  });
}

/** Feed a real upstream response (our platform key only). Trips the breaker on a definite credit failure. */
export function noteProviderResponse(p: ProviderName, status: number, body: string): void {
  if (!isCreditExhaustion(status, body)) return;
  const tripped = !get(p).exhausted;
  markExhausted(p, `${PROVIDER_LABEL[p]} returned ${status}: ${body.slice(0, 200)}`);
  // Read the balance now, before a top-up can land, so recovery means "rose since we ran dry".
  if (tripped) void probeProvider(p);
}

/** The exhausted providers that make this tool unavailable (all of its providers), or null if usable. */
export function unavailableProviders(tool: string): ProviderName[] | null {
  const ps = TOOL_PROVIDERS[tool];
  if (!ps) return null;
  return ps.every((p) => get(p).exhausted) ? ps : null;
}

export function providerHealthSnapshot(): Record<string, ProviderState & { tools: string[] }> {
  const out: Record<string, ProviderState & { tools: string[] }> = {};
  for (const p of Object.keys(PROVIDER_LABEL) as ProviderName[]) out[p] = { ...get(p), tools: toolsFor(p) };
  return out;
}

// ─── Active probes ───────────────────────────────────────────────────────────
// Endpoints proven live on 2026-11-02 (backend audit); all read-only except
// OpenAI, which has no balance API for project keys (a 1-token call, ~$0.000001).

type Probe = () => Promise<{ status: number; body: string; balance?: number }>;

const fetchJson = async (url: string, init: RequestInit = {}): Promise<{ status: number; body: string; json: any }> => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const body = await r.text();
  let json: any = null;
  try { json = JSON.parse(body); } catch { /* not JSON */ }
  return { status: r.status, body, json };
};

const PROBES: Partial<Record<ProviderName, { key: string; probe: Probe }>> = {
  openai: {
    key: "OPENAI_API_KEY",
    probe: async () => {
      const r = await fetchJson("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
      });
      return { status: r.status, body: r.body };
    },
  },
  runway: {
    key: "RUNWAY_API_KEY",
    probe: async () => {
      const r = await fetchJson("https://api.dev.runwayml.com/v1/organization", {
        headers: { Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`, "X-Runway-Version": "2024-11-06" },
      });
      return { status: r.status, body: r.body, balance: typeof r.json?.creditBalance === "number" ? r.json.creditBalance : undefined };
    },
  },
  stability: {
    key: "STABILITY_API_KEY",
    probe: async () => {
      const r = await fetchJson("https://api.stability.ai/v1/user/balance", { headers: { Authorization: `Bearer ${process.env.STABILITY_API_KEY}` } });
      return { status: r.status, body: r.body, balance: typeof r.json?.credits === "number" ? r.json.credits : undefined };
    },
  },
  removebg: {
    key: "REMOVEBG_API_KEY",
    probe: async () => {
      const r = await fetchJson("https://api.remove.bg/v1.0/account", { headers: { "X-Api-Key": process.env.REMOVEBG_API_KEY ?? "" } });
      const total = r.json?.data?.attributes?.credits?.total; // {subscription, payg, enterprise, total}
      return { status: r.status, body: r.body, balance: typeof total === "number" ? total : undefined };
    },
  },
  elevenlabs: {
    key: "ELEVENLABS_API_KEY",
    probe: async () => {
      const r = await fetchJson("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" } });
      const left = typeof r.json?.character_limit === "number" && typeof r.json?.character_count === "number"
        ? r.json.character_limit - r.json.character_count : undefined;
      return { status: r.status, body: r.body, balance: left };
    },
  },
  hunter: {
    key: "HUNTER_API_KEY",
    probe: async () => {
      const r = await fetchJson(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(process.env.HUNTER_API_KEY ?? "")}`);
      const left = r.json?.data?.requests?.searches?.remaining; // {used, available, remaining}
      return { status: r.status, body: r.body, balance: typeof left === "number" ? left : undefined };
    },
  },
};

const HEALTHY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EXHAUSTED_INTERVAL_MS = 30 * 60 * 1000;

async function probeProvider(p: ProviderName): Promise<void> {
  const entry = PROBES[p];
  if (!entry || !process.env[entry.key]) return;
  const s = get(p);
  try {
    const r = await entry.probe();
    s.lastCheck = new Date().toISOString();
    s.lastCheckOk = r.status >= 200 && r.status < 300;
    if (r.balance !== undefined) {
      s.balance = r.balance;
      // Out of credit with no baseline yet (a live failure tripped the breaker): this
      // first fresh reading is the baseline, so this probe cannot recover on it.
      if (s.exhausted && s.balanceAtExhaustion === undefined) s.balanceAtExhaustion = r.balance;
    }
    if (isCreditExhaustion(r.status, r.body) || (r.balance !== undefined && r.balance < (MIN_BALANCE[p] ?? 1))) {
      markExhausted(p, `${PROVIDER_LABEL[p]} probe: ${r.balance !== undefined ? `balance ${r.balance}` : `${r.status} ${r.body.slice(0, 160)}`}`, r.balance);
    } else if (s.exhausted && s.lastCheckOk) {
      // Balance providers recover only when the balance rose (a top-up);
      // OpenAI (no balance) recovers when the probe call succeeds.
      const rose = r.balance === undefined || s.balanceAtExhaustion === undefined || r.balance > s.balanceAtExhaustion;
      if (rose) markRecovered(p, r.balance !== undefined ? `Balance is now ${r.balance}.` : "A test call succeeded.");
    }
  } catch {
    s.lastCheck = new Date().toISOString();
    s.lastCheckOk = false; // network error: no state change either way
  }
}

/** Run the probes that are due (or all, with force). Exported for the admin endpoint and tests. */
export async function runProviderProbes(force = false): Promise<void> {
  const now = Date.now();
  await Promise.all((Object.keys(PROBES) as ProviderName[]).map(async (p) => {
    const s = get(p);
    const due = force || !s.lastCheck || now - Date.parse(s.lastCheck) >= (s.exhausted ? EXHAUSTED_INTERVAL_MS : HEALTHY_INTERVAL_MS);
    if (due) await probeProvider(p);
  }));
}

let started = false;
export function startProviderHealth(): void {
  if (started) return;
  started = true;
  setTimeout(() => { void runProviderProbes(); }, 60 * 1000).unref();
  setInterval(() => { void runProviderProbes(); }, EXHAUSTED_INTERVAL_MS).unref();
}

/** Test hook: reset all state. */
export function __resetProviderHealth(): void { state.clear(); }
