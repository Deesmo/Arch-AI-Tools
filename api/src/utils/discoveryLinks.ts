/**
 * Machine-readable free-signup discovery links for AI agents.
 *
 * Attached under a namespaced `links` object to Arch Tools' OWN
 * application-level unauthenticated error bodies ONLY:
 *   - the x402 402 Payment Required JSON body (middleware/x402.ts) — the
 *     base64 PAYMENT-REQUIRED header stays byte-identical to the spec §5.1
 *     PaymentRequired (bodies are a server implementation concern per
 *     coinbase/x402 specs/transports-v2/http.md)
 *   - the missing-API-key 401 JSON from our auth middleware
 *     (middleware/auth.ts requireAuth)
 *
 * Deliberately NOT attached to: any WWW-Authenticate header, the OAuth
 * routes' standards-defined error shapes, or /mcp's 401 challenge (which
 * drives the client OAuth flow and must remain byte-identical).
 */
export const DISCOVERY_LINKS = Object.freeze({
  signup: "https://archtools.dev/signup",
  free_credits: 25,
  docs: "https://archtools.dev/docs",
  mcp: "https://archtools.dev/mcp",
});
