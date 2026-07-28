/**
 * Email-verification pages (2026-07-28 activation launchpad).
 *
 * Three server-rendered pages for the verify-email flow:
 *   1. Confirm page  — rendered on GET; a "Confirm" button POSTs the token so
 *      email-security scanners that prefetch GET links can't burn it.
 *   2. Activation page — rendered after the POST consumes the token; a
 *      credential-free launchpad (these pages are reachable from an emailed
 *      link, so they must NEVER contain an API key, write to localStorage,
 *      or auto-fire API calls — zero JavaScript by design).
 *   3. Error page — invalid / expired / already-used token.
 *
 * Styling mirrors the signup page (assets/signupHtml.ts).
 */

const SITE = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");

/** Verify tokens are crypto.randomBytes(32).toString("hex") — exactly 64 hex chars. */
export const VERIFY_TOKEN_RE = /^[a-f0-9]{64}$/i;

// ─── Shared page shell (matches site styling) ───
function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>${title} — Arch Tools</title>
  <link rel="icon" href="/arch-icon.svg?v=2" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #07061A;
      --card: rgba(255,255,255,0.05);
      --border: rgba(255,255,255,0.10);
      --text: rgba(255,255,255,0.92);
      --muted: rgba(255,255,255,0.55);
      --green: #34d399;
      --grad: linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);
    }
    body {
      font-family: Syne, system-ui, sans-serif;
      background: radial-gradient(900px 500px at 20% 10%, rgba(85,34,255,0.18), transparent 65%),
                  radial-gradient(700px 400px at 80% 80%, rgba(255,24,136,0.12), transparent 65%),
                  var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    .page { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 40px 16px; }
    .wrap { width: 100%; max-width: 560px; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 28px;
      backdrop-filter: blur(12px);
    }
    .brand { display: flex; align-items: center; gap: 9px; margin-bottom: 20px; }
    .brand-name { font-weight: 700; font-size: 15px; letter-spacing: -0.02em; }
    .card-title { font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 8px; }
    .card-sub { font-size: 14px; color: var(--muted); line-height: 1.6; margin-bottom: 22px; }
    .card-sub strong { color: var(--text); }
    .btn-primary {
      display: inline-block; height: 46px; line-height: 46px; padding: 0 24px;
      border-radius: 12px; border: 0;
      background: var(--grad); color: #fff; font-weight: 700; font-size: 14px;
      font-family: inherit; cursor: pointer; white-space: nowrap; text-decoration: none;
    }
    .cta { border: 1px solid var(--border); border-radius: 14px; padding: 18px; margin-bottom: 14px; background: rgba(0,0,0,0.2); }
    .cta h3 { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
    .cta p { font-size: 13px; color: var(--muted); line-height: 1.6; margin-bottom: 10px; }
    .cta a { color: #22d3ee; text-decoration: none; }
    .cta a:hover { text-decoration: underline; }
    .code {
      font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px;
      background: rgba(0,0,0,0.35); border: 1px solid var(--border); border-radius: 10px;
      padding: 12px 14px; white-space: pre-wrap; word-break: break-all; color: var(--text);
      line-height: 1.6;
    }
    .badge {
      display: inline-block; padding: 6px 12px; border-radius: 999px;
      border: 1px solid rgba(52,211,153,0.35); background: rgba(52,211,153,0.08);
      color: var(--green); font-size: 13px; font-weight: 600; margin-bottom: 16px;
    }
    .foot { margin-top: 16px; font-size: 12px; color: var(--muted); }
    .foot a { color: rgba(255,255,255,0.65); text-decoration: none; }
    .foot a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="page"><div class="wrap"><div class="card">
    <div class="brand">
      <svg viewBox="0 10 100 90" overflow="visible" width="22" height="22"><defs><linearGradient id="arch-grad-vf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF9010"/><stop offset="60%" stop-color="#FF2896"/><stop offset="100%" stop-color="#8844FF"/></linearGradient></defs><path fill="url(#arch-grad-vf)" d="M15,100L15,55A35,35,0,0,1,85,55L85,100L74,100L74,55A24,24,0,0,0,26,55L26,100Z M34,100L34,55A16,16,0,0,1,66,55L66,100L58,100L58,55A8,8,0,0,0,42,55L42,100Z"/></svg>
      <span class="brand-name">Arch Tools</span>
    </div>
    ${body}
  </div></div></div>
</body>
</html>`;
}

/**
 * GET page: asks the human to click Confirm, which POSTs the token back.
 * The token is embedded in a hidden form field — it is validated against
 * VERIFY_TOKEN_RE (hex-only) before rendering, which also makes HTML/attr
 * injection impossible. Throws if a caller ever passes an unvalidated token.
 */
export function renderVerifyConfirmPage(token: string, pendingCredits: number): string {
  if (!VERIFY_TOKEN_RE.test(token)) {
    throw new Error("renderVerifyConfirmPage requires a validated hex verify token");
  }
  const creditsLine = pendingCredits > 0
    ? `Confirming activates your remaining <strong>${pendingCredits.toLocaleString()} credits</strong>.`
    : `Confirming marks your email address as verified.`;
  return pageShell("Confirm your email", `
    <h1 class="card-title">Confirm your email</h1>
    <p class="card-sub">One click to finish. ${creditsLine}</p>
    <form method="POST" action="/v1/agent/verify-email">
      <input type="hidden" name="token" value="${token}">
      <button type="submit" class="btn-primary">Confirm my email →</button>
    </form>
    <p class="foot">Didn't sign up for Arch Tools? You can safely close this page — nothing happens until the button is clicked.</p>
  `);
}

/**
 * POST-success page: the credential-free activation launchpad.
 * NO API key, NO localStorage, NO scripts, NO auto-fired calls — this page is
 * reachable from an emailed link.
 */
export function renderVerifyActivationPage(creditsActivated: number): string {
  const headline = creditsActivated > 0
    ? `Your <strong>${creditsActivated.toLocaleString()} bonus credits</strong> are now active on your account.`
    : `Your email address is verified.`;
  return pageShell("Email verified", `
    <div class="badge">✓ Email verified</div>
    <h1 class="card-title">You're all set</h1>
    <p class="card-sub">${headline} Three ways to make your first call:</p>

    <div class="cta">
      <h3>1 · Connect to Claude or ChatGPT</h3>
      <p>Open your AI app's connector settings (Claude: Settings → Connectors → Add custom connector).<br>
      Paste this URL and authorize — all 63 tools appear in your chat:</p>
      <div class="code">${SITE}/mcp</div>
    </div>

    <div class="cta">
      <h3>2 · Make your first API call</h3>
      <p>Costs 1 credit. Replace the placeholder with the API key from your signup / welcome email:</p>
      <div class="code">curl -X POST ${SITE}/v1/tools/generate-uuid \\
  -H "x-api-key: &lt;YOUR_API_KEY&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"count": 3}'</div>
      <p style="margin-top:10px;margin-bottom:0;">Full reference for all 63 tools: <a href="${SITE}/docs">${SITE}/docs</a></p>
    </div>

    <div class="cta">
      <h3>3 · Open your dashboard</h3>
      <p style="margin-bottom:0;">Log in to view your API key, live credit balance, and usage: <a href="${SITE}/dashboard">${SITE}/dashboard</a></p>
    </div>

    <p class="foot">Credits never expire. Questions? <a href="${SITE}/docs">Docs</a> · <a href="${SITE}/dashboard">Dashboard</a></p>
  `);
}

/** Invalid / expired / already-used token. */
export function renderVerifyErrorPage(): string {
  return pageShell("Link invalid or expired", `
    <h1 class="card-title">Link invalid or expired</h1>
    <p class="card-sub">This verification link is invalid, expired, or was already used.
    If you clicked it before, your email may already be verified — sign in to your
    <a href="${SITE}/dashboard" style="color:#22d3ee;text-decoration:none;">dashboard</a> to check your status and credit balance.</p>
    <a class="btn-primary" href="${SITE}/dashboard">Open dashboard →</a>
  `);
}
