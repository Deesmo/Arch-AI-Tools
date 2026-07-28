/**
 * oauthNext — helpers for the OAuth-consent → signup → resume-consent loop.
 *
 * When a user without an Arch Tools account lands on the OAuth consent page
 * (/oauth/authorize from Claude/ChatGPT/etc.), the consent page offers a
 * "create a free account" link that round-trips the ORIGINAL authorize URL
 * through /signup?next=... so the user can resume consent after signup.
 *
 * The `next` value is attacker-controllable (it arrives on a public GET), so
 * it is validated server-side (GET /signup in index.ts) and client-side
 * (signup page JS) with the same rule: only a same-origin path targeting
 * /oauth/authorize is ever honored. Everything else is dropped — this is the
 * open-redirect guard.
 */

/**
 * True iff `next` is a safe, same-origin OAuth authorize path:
 *   "/oauth/authorize" or "/oauth/authorize?<query>"
 *
 * Rejects, by construction:
 *  - absolute/external URLs ("https://evil.com/...") — no leading "/oauth"
 *  - protocol-relative URLs ("//evil.com/...") — second char is "/"
 *  - scheme-ful values ("javascript:alert(1)") — no leading "/"
 *  - path traversal ("/oauth/authorize/../x") and lookalike paths
 *    ("/oauth/authorizeevil") — only "" or "?" may follow the exact path
 *  - whitespace, control chars, backslashes (parser-quirk vectors) and
 *    <>"'` (HTML-attribute breakout vectors), so the validated value is
 *    safe to embed in a double-quoted href attribute
 */
export function isSafeOAuthNext(next: unknown): next is string {
  if (typeof next !== "string") return false;
  if (next.length === 0 || next.length > 2048) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s\\<>"'`]/.test(next)) return false;
  return next === "/oauth/authorize" || next.startsWith("/oauth/authorize?");
}

/**
 * Rebuild the /oauth/authorize URL (same-origin, path + query only) from the
 * validated params the consent page already holds, preserving the OAuth
 * transaction (client_id, redirect_uri, state, PKCE challenge, scope) so
 * consent can resume after signup. URLSearchParams percent-encodes every
 * value, so the result always passes isSafeOAuthNext (round-trip property,
 * covered by tests/oauth-signup-cta.test.mjs).
 */
export function buildOAuthAuthorizeNext(p: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}): string {
  const params = new URLSearchParams({
    client_id: String(p.clientId ?? ""),
    redirect_uri: String(p.redirectUri ?? ""),
    response_type: "code",
    scope: String(p.scope ?? ""),
  });
  if (p.state) params.set("state", p.state);
  if (p.codeChallenge) {
    params.set("code_challenge", p.codeChallenge);
    params.set("code_challenge_method", p.codeChallengeMethod || "S256");
  }
  return `/oauth/authorize?${params.toString()}`;
}
