export const SIGNUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arch Tools — Get your API key</title>
  <meta name="description" content="Create your Arch Tools account. Get your API key and 25 free credits instantly. Verify your email to unlock all 100." />
  <link rel="apple-touch-icon" href="/apple-touch-icon-v2.png" />
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
      --accent: #22d3ee;
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
    /* ── NAV ── */
    .at-nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px; height: 60px;
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(12px);
      background: rgba(7,6,26,0.85);
      position: sticky; top: 0; z-index: 100;
    }
    .at-nav-logo { display: flex; align-items: center; gap: 9px; text-decoration: none; color: var(--text); }
    .at-logo-mark {
      width: 32px; height: 32px; border-radius: 8px;
      background: var(--bg);
      border: 1px solid rgba(255,255,255,0.12);
      display: grid; place-items: center;
    }
    .at-logo-name { font-weight: 700; font-size: 15px; letter-spacing: -0.02em; }
    .at-nav-links { display: flex; align-items: center; gap: 24px; font-size: 13px; }
    .at-nav-links a { color: var(--muted); text-decoration: none; transition: color 0.15s; }
    .at-nav-links a:hover { color: var(--text); }
    .at-nav-cta {
      background: var(--grad); color: #fff !important; font-weight: 700;
      padding: 7px 14px; border-radius: 8px; font-size: 12px !important;
    }
    /* HAMBURGER */
    .hamburger { display:none; background:none; border:none; cursor:pointer; padding:6px; }
    .hamburger svg { width:24px; height:24px; stroke:var(--text); stroke-width:2; stroke-linecap:round; }
    .mobile-menu { display:none; flex-direction:column; gap:6px; padding:12px 24px 16px; border-bottom:1px solid var(--border); background:rgba(7,6,26,0.95); }
    .mobile-menu a { color:var(--muted); text-decoration:none; font-size:14px; padding:8px 0; }
    .mobile-menu a:hover { color:var(--text); }
    .mobile-menu.open { display:flex; }
    @media (max-width: 768px) {
      .at-nav-links { display: none; }
      .hamburger { display:block; }
    }
    /* ── PAGE ── */
    .page {
      display: flex; align-items: center; justify-content: center;
      min-height: calc(100vh - 60px);
      padding: 40px 16px;
    }
    .wrap { width: 100%; max-width: 500px; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 28px;
      backdrop-filter: blur(12px);
    }
    .card-title { font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 8px; }
    .card-sub { font-size: 14px; color: var(--muted); line-height: 1.6; margin-bottom: 22px; }
    .input-row { display: flex; gap: 10px; }
    input[type="email"] {
      flex: 1; height: 46px; border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(0,0,0,0.3); color: var(--text);
      padding: 0 14px; font-size: 14px; font-family: inherit; outline: none;
    }
    input[type="email"]:focus { border-color: rgba(34,211,238,0.5); box-shadow: 0 0 0 3px rgba(34,211,238,0.08); }
    .btn-primary {
      height: 46px; padding: 0 20px; border-radius: 12px; border: 0;
      background: var(--grad); color: #fff; font-weight: 700; font-size: 14px;
      font-family: inherit; cursor: pointer; white-space: nowrap;
      transition: opacity 0.15s;
    }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .status { margin-top: 16px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--border); background: rgba(0,0,0,0.2); display: none; }
    .mono { font-family: "JetBrains Mono", ui-monospace, monospace; }
    .legal { margin-top: 14px; font-size: 12px; color: var(--muted); }
    .legal a { color: rgba(255,255,255,0.65); text-decoration: none; }
    .legal a:hover { text-decoration: underline; }
    .copy-btn-full {
      width: 100%; height: 42px; border-radius: 10px; border: 0;
      background: var(--grad); color: #fff; font-weight: 700; font-size: 14px;
      font-family: inherit; cursor: pointer; margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <nav class="at-nav">
    <a class="at-nav-logo" href="/">
      <div class="at-logo-mark">
        <svg viewBox="0 10 100 90" overflow="visible" width="20" height="20"><defs><linearGradient id="arch-grad-nav-su" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF9010"/><stop offset="60%" stop-color="#FF2896"/><stop offset="100%" stop-color="#8844FF"/></linearGradient><filter id="arch-neon-nav-su"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path fill="url(#arch-grad-nav-su)" filter="url(#arch-neon-nav-su)" d="M15,100L15,55A35,35,0,0,1,85,55L85,100L74,100L74,55A24,24,0,0,0,26,55L26,100Z M34,100L34,55A16,16,0,0,1,66,55L66,100L58,100L58,55A8,8,0,0,0,42,55L42,100Z"/></svg>
      </div>
      <span class="at-logo-name">Arch Tools</span>
    </a>
    <div class="at-nav-links">
      <a href="/">Home</a>
      <a href="/docs">Docs</a>
      <a href="/changelog">Changelog</a>
      <a href="/#pricing">Pricing</a>
      <a href="/signup" class="at-nav-cta">Get API Key</a>
    </div>
    <button class="hamburger" onclick="document.getElementById('mobile-menu').classList.toggle('open')" aria-label="Menu">
      <svg viewBox="0 0 24 24" fill="none"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
  </nav>
  <div id="mobile-menu" class="mobile-menu">
    <a href="/">Home</a>
    <a href="/docs">Docs</a>
    <a href="/changelog">Changelog</a>
    <a href="/#pricing">Pricing</a>
    <a href="/signup">Get API Key</a>
  </div>

  <div class="page">
    <div class="wrap">
      <div class="card">
        <div class="card-title">Get your API key</div>
        <p class="card-sub">Enter your email — your key and 25 free credits are issued instantly. Verify your email to unlock the remaining 75 (100 total). No credit card required.</p>

        <div class="input-row">
          <input id="email" type="email" placeholder="you@company.com" autocomplete="email" />
          <button id="btn" class="btn-primary">Get API Key</button>
        </div>
        <div style="margin-top:10px;">
          <input id="password" type="password" placeholder="Set a password (optional — enables login later)" autocomplete="new-password" style="width:100%;height:46px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.92);padding:0 14px;font-family:inherit;font-size:13px;outline:none;box-sizing:border-box;" />
        </div>

        <div id="status" class="status"></div>

        <div class="legal">
          By continuing you agree to our <a href="/legal/terms">Terms</a> and <a href="/legal/privacy">Privacy Policy</a>.
        </div>
      </div>
    </div>
  </div>

  <script>
    const statusEl = document.getElementById('status');
    const btn = document.getElementById('btn');

    (function() {
      const params = new URLSearchParams(window.location.search);
      const preKey = params.get('key');
      const preCredits = parseInt(params.get('credits') || '250', 10);

      // Referral attribution: remember ?ref= so the new user can apply it from
      // the dashboard after email verification, and record the link click.
      const refCode = (params.get('ref') || '').trim();
      if (refCode && /^[A-Za-z0-9_-]{4,40}$/.test(refCode)) {
        try { localStorage.setItem('arch_ref_code', refCode); } catch(_) {}
        fetch('/v1/affiliate/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: refCode, referrer_url: document.referrer || null })
        }).catch(function() {});
      }

      // Strict format check (arch_ + hex) — this value comes from the URL and
      // is rendered into the page, so never accept anything key-shaped-but-not.
      if (preKey && /^arch_[A-Za-z0-9]{16,96}$/.test(preKey)) {
        showSuccess(preKey, preCredits);
        btn.style.display = 'none';
        document.getElementById('email').style.display = 'none';
        history.replaceState({}, '', '/signup');
        if (preKey) {
          localStorage.setItem('arch_api_key', preKey);
        }
        return;
      }
    })();

    document.getElementById('btn').addEventListener('click', sendLink);

    function showStatus(html) {
      statusEl.innerHTML = html;
      statusEl.style.display = 'block';
    }

    function showSuccess(apiKey, credits) {
      if (apiKey) localStorage.setItem('arch_api_key', apiKey);
      // Referral note: if this signup arrived via a referral link, tell the
      // user how to claim the bonus (verify email, then apply on the dashboard).
      var refNote = '';
      try {
        var savedRef = localStorage.getItem('arch_ref_code') || '';
        if (/^[A-Za-z0-9_-]{4,40}$/.test(savedRef)) {
          refNote = '<div style="font-size:12px;color:#34d399;margin-bottom:12px;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);border-radius:10px;padding:10px 12px">&#127873; Referral code <strong>' + savedRef + '</strong> saved. Verify your email, then apply it from your dashboard — you and your referrer each get bonus credits.</div>';
        }
      } catch(_) {}
      showStatus(
        '<div style="margin-bottom:12px;font-size:17px;font-weight:800;color:#34d399">&#9989; Account created!</div>' +
        '<div style="margin-bottom:8px;font-size:12px;color:rgba(255,255,255,0.5)">Your API key — copy it now, it won&#39;t be shown again:</div>' +
        '<div id="api-key-box" class="mono" style="background:rgba(0,0,0,0.4);border:1px solid rgba(0,229,176,0.35);padding:10px 14px;border-radius:10px;word-break:break-all;font-size:13px;margin-bottom:12px;user-select:all;color:#e0ffe0">' + apiKey + '</div>' +
        '<button id="copy-btn" class="copy-btn-full">Copy API Key</button>' +
        '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:12px">You have <strong style="color:#f0f0f6">' + credits + ' credits</strong> to get started. Refreshed monthly on the free plan. No subscription required.</div>' +
        refNote +
        '<div style="border-top:1px solid rgba(255,255,255,0.1);margin:14px 0 0;padding-top:14px">' +
          '<div style="font-size:13px;font-weight:700;margin-bottom:8px">Try it now</div>' +
          '<button id="first-call-btn" class="copy-btn-full" style="background:rgba(34,211,238,0.12);border:1px solid rgba(34,211,238,0.4);color:#22d3ee">Run your first call (uses 1 of your ' + credits + ' free credits)</button>' +
          '<div id="first-call-result" style="display:none;margin-bottom:12px"></div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:6px">Or from your terminal:</div>' +
          '<pre id="first-call-curl" class="mono" style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);padding:10px 14px;border-radius:10px;font-size:11px;overflow-x:auto;white-space:pre;margin:0 0 12px;user-select:all"></pre>' +
        '</div>' +
        '<div style="margin:0 0 14px">' +
          '<div style="font-size:13px;font-weight:700;margin-bottom:6px">Connect via MCP</div>' +
          '<div class="mono" style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);padding:8px 12px;border-radius:10px;font-size:12px;user-select:all;margin-bottom:6px">https://archtools.dev/mcp</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1.6">Claude: Settings &#8594; Connectors &#8594; Add custom connector &#8594; paste the URL above.<br>ChatGPT: Settings &#8594; Connectors &#8594; Create &#8594; paste the URL above.</div>' +
        '</div>' +
        '<a href="/dashboard" style="display:block;text-align:center;padding:10px;border-radius:10px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);color:#22d3ee;font-weight:700;text-decoration:none;font-size:14px">&#8594; Open Dashboard</a>'
      );
      const copyBtn = document.getElementById('copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', function() {
          navigator.clipboard.writeText(apiKey).then(function() {
            copyBtn.textContent = '✓ Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy API Key'; }, 2000);
          });
        });
      }
      // Curl example with the fresh key prefilled. Set via textContent (never
      // string-built HTML) so the key can never be interpreted as markup.
      var curlEl = document.getElementById('first-call-curl');
      if (curlEl) {
        var keyForCurl = /^arch_[A-Za-z0-9]{16,96}$/.test(apiKey) ? apiKey : 'YOUR_API_KEY';
        curlEl.textContent = 'curl -X POST https://archtools.dev/v1/tools/generate-uuid -H "Authorization: Bearer ' + keyForCurl + '" -H "Content-Type: application/json" -d ' + "'{}'";
      }
      // Opt-in only: the call fires exclusively from this click handler —
      // nothing on this page ever auto-spends a credit.
      var fcBtn = document.getElementById('first-call-btn');
      if (fcBtn) {
        fcBtn.addEventListener('click', function() { runFirstCall(apiKey, fcBtn); });
      }
    }

    function runFirstCall(apiKey, fcBtn) {
      var out = document.getElementById('first-call-result');
      if (!out) return;
      var originalLabel = fcBtn.textContent;
      fcBtn.disabled = true;
      fcBtn.textContent = 'Calling generate-uuid...';
      // Hard 2s budget: first impression must never be a hanging spinner.
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function() { ctrl.abort(); }, 2000) : null;
      var clearTimer = function() { if (timer) { clearTimeout(timer); timer = null; } };
      fetch('/v1/tools/generate-uuid', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'X-Arch-Source': 'onboarding'
        },
        body: '{}',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function(res) {
        clearTimer();
        var remaining = res.headers.get('X-Credits-Remaining');
        return res.json().then(function(data) {
          if (!res.ok) { showFirstCallFallback(out, fcBtn, originalLabel); return; }
          showFirstCallResult(out, data, remaining);
          fcBtn.textContent = '✓ First call complete';
        });
      }).catch(function() {
        clearTimer();
        showFirstCallFallback(out, fcBtn, originalLabel);
      });
    }

    function showFirstCallResult(out, data, remaining) {
      out.innerHTML = '';
      out.style.display = 'block';
      var pre = document.createElement('pre');
      pre.className = 'mono';
      pre.style.cssText = 'background:rgba(0,0,0,0.4);border:1px solid rgba(52,211,153,0.35);padding:10px 14px;border-radius:10px;font-size:11px;overflow-x:auto;white-space:pre;margin:0 0 6px';
      var rendered;
      try { rendered = JSON.stringify(data, null, 2); } catch(_) { rendered = String(data); }
      // Escaped by construction: textContent, never innerHTML, for API output.
      pre.textContent = rendered;
      out.appendChild(pre);
      var note = document.createElement('div');
      note.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.55);margin-bottom:6px';
      note.textContent = (remaining !== null && remaining !== '')
        ? 'Credits remaining: ' + remaining
        : 'Your balance is on the X-Credits-Remaining response header.';
      out.appendChild(note);
    }

    function showFirstCallFallback(out, fcBtn, originalLabel) {
      out.innerHTML = '';
      out.style.display = 'block';
      var note = document.createElement('div');
      note.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.65);background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px 12px';
      note.textContent = 'The live call did not complete in time. Run it from your terminal instead — the curl command below has your key prefilled.';
      out.appendChild(note);
      fcBtn.disabled = false;
      fcBtn.textContent = originalLabel;
    }

    async function sendLink() {
      const email = (document.getElementById('email').value || '').trim();
      if (!email) { showStatus('<span style="color:#f87171">Enter your email to continue.</span>'); return; }
      btn.disabled = true;
      btn.textContent = 'Creating account...';
      try {
        const res = await fetch('/v1/agent/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, plan: new URLSearchParams(window.location.search).get('plan') || 'free' })
        });
        let data;
        try { data = await res.json(); } catch(_) { data = {}; }
        if (res.ok && data.api_key) {
          // If password provided, set it and log in via session cookie
          const pw = (document.getElementById('password').value || '').trim();
          if (pw && pw.length >= 8) {
            try {
              await fetch('/auth/set-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ api_key: data.api_key, password: pw })
              });
            } catch(_) {}
          }
          showSuccess(data.api_key, data.credits || 250);
          btn.style.display = 'none';
          document.getElementById('email').style.display = 'none';
          document.getElementById('password').style.display = 'none';
        } else {
          const msg = data.error === 'email_exists'
            ? 'An account with this email already exists. <a href="/dashboard" style="color:#22d3ee">&#8594; Open Dashboard</a>'
            : (data.message || 'Something went wrong. Please try again.');
          showStatus('<span style="color:#f87171">&#9888;&#65039; ' + msg + '</span>');
        }
      } catch(_) {
        showStatus('<span style="color:#f87171">Connection error. Please try again.</span>');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Get API Key';
      }
    }
  </script>
  <footer style="border-top:1px solid rgba(255,255,255,0.06);padding:24px 0;text-align:center;font-size:12px;color:rgba(255,255,255,0.35);margin-top:48px;">
    © 2026 MCMetaverse LLC · <a href="/terms.html" style="color:rgba(255,255,255,0.45);text-decoration:none;">Terms</a> · <a href="/privacy.html" style="color:rgba(255,255,255,0.45);text-decoration:none;">Privacy</a> · <a href="/docs" style="color:rgba(255,255,255,0.45);text-decoration:none;">Docs</a>
  </footer>
<!-- Arch Tools Chat Widget --><style>#arch-chat-bubble{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);border:none;cursor:pointer;z-index:99999;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(85,34,255,0.4);transition:transform .2s,box-shadow .2s}#arch-chat-bubble:hover{transform:scale(1.1);box-shadow:0 6px 32px rgba(85,34,255,0.6)}#arch-chat-bubble svg{width:28px;height:28px;fill:#fff}#arch-chat-window{position:fixed;bottom:92px;right:24px;width:380px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#0c0b1e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;z-index:99999;display:none;flex-direction:column;overflow:hidden;box-shadow:0 8px 48px rgba(0,0,0,0.6);font-family:'JetBrains Mono',monospace}#arch-chat-window.open{display:flex}#arch-chat-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:linear-gradient(135deg,rgba(85,34,255,0.15),rgba(255,24,136,0.1));border-bottom:1px solid rgba(255,255,255,0.08)}#arch-chat-header .ach-title{font-size:14px;font-weight:600;color:#fff;display:flex;align-items:center;gap:8px}#arch-chat-header .ach-title .ach-dot{width:8px;height:8px;border-radius:50%;background:#34d399;animation:ach-pulse 2s infinite}@keyframes ach-pulse{0%,100%{opacity:1}50%{opacity:.4}}#arch-chat-close{background:none;border:none;color:rgba(255,255,255,0.5);font-size:20px;cursor:pointer;padding:4px 8px;line-height:1}#arch-chat-close:hover{color:#fff}#arch-chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}#arch-chat-messages::-webkit-scrollbar{width:4px}#arch-chat-messages::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:4px}.ach-msg{max-width:85%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}.ach-msg.bot{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.88);border-bottom-left-radius:4px;align-self:flex-start}.ach-msg.user{background:linear-gradient(135deg,#5522FF,#FF1888);color:#fff;border-bottom-right-radius:4px;align-self:flex-end}.ach-typing{display:flex;gap:4px;padding:10px 14px;align-self:flex-start}.ach-typing span{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.3);animation:ach-bounce .6s infinite alternate}.ach-typing span:nth-child(2){animation-delay:.2s}.ach-typing span:nth-child(3){animation-delay:.4s}@keyframes ach-bounce{to{opacity:1;transform:translateY(-4px)}}#arch-chat-input-row{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(7,6,26,0.8)}#arch-chat-input{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:#fff;font-size:13px;font-family:'JetBrains Mono',monospace;outline:none;resize:none}#arch-chat-input::placeholder{color:rgba(255,255,255,0.3)}#arch-chat-input:focus{border-color:rgba(85,34,255,0.5)}#arch-chat-send{background:linear-gradient(135deg,#5522FF,#FF1888);border:none;border-radius:8px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .2s}#arch-chat-send:hover{opacity:.85}#arch-chat-send:disabled{opacity:.4;cursor:not-allowed}#arch-chat-send svg{width:18px;height:18px;fill:#fff}@media(max-width:480px){#arch-chat-window{bottom:0;right:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}}</style><button id="arch-chat-bubble" aria-label="Open chat" onclick="archChatToggle()"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg></button><div id="arch-chat-window"><div id="arch-chat-header"><div class="ach-title"><div class="ach-dot"></div>Arch Tools Support</div><button id="arch-chat-close" onclick="archChatToggle()" aria-label="Close chat">&times;</button></div><div id="arch-chat-messages"><div class="ach-msg bot">Hey! 👋 I'm the Arch Tools assistant. Ask me about our API, pricing, MCP setup, x402 payments, or anything else!</div></div><div id="arch-chat-input-row"><input type="text" id="arch-chat-input" placeholder="Ask about Arch Tools..." maxlength="2000" autocomplete="off" /><button id="arch-chat-send" onclick="archChatSend()" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div></div><script>(function(){var chatHistory=[],sending=false;window.archChatToggle=function(){var w=document.getElementById('arch-chat-window');w.classList.toggle('open');if(w.classList.contains('open'))document.getElementById('arch-chat-input').focus()};function addMsg(text,role){var msgs=document.getElementById('arch-chat-messages'),d=document.createElement('div');d.className='ach-msg '+(role==='user'?'user':'bot');d.textContent=text;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;chatHistory.push({role:role,content:text});if(chatHistory.length>20)chatHistory=chatHistory.slice(-20)}function showTyping(){var msgs=document.getElementById('arch-chat-messages'),t=document.createElement('div');t.className='ach-typing';t.id='ach-typing-ind';t.innerHTML='<span></span><span></span><span></span>';msgs.appendChild(t);msgs.scrollTop=msgs.scrollHeight}function hideTyping(){var t=document.getElementById('ach-typing-ind');if(t)t.remove()}window.archChatSend=function(){if(sending)return;var inp=document.getElementById('arch-chat-input'),msg=inp.value.trim();if(!msg)return;inp.value='';addMsg(msg,'user');sending=true;document.getElementById('arch-chat-send').disabled=true;showTyping();fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,history:chatHistory.slice(0,-1)})}).then(function(r){return r.json()}).then(function(d){hideTyping();if(d.ok&&d.reply)addMsg(d.reply,'assistant');else addMsg('Sorry, something went wrong. Please try again.','assistant')}).catch(function(){hideTyping();addMsg('Connection error. Please try again.','assistant')}).finally(function(){sending=false;document.getElementById('arch-chat-send').disabled=false})};document.addEventListener('keydown',function(e){if(e.key==='Enter'&&document.activeElement===document.getElementById('arch-chat-input')&&!e.shiftKey){e.preventDefault();archChatSend()}})})();</script>
</body>
</html>`;
