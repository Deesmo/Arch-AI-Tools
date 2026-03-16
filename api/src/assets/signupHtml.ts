export const SIGNUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arch Tools — Get your API key</title>
  <meta name="description" content="Create your Arch Tools account. Get your API key instantly — no email verification required. 100 free credits included." />
  <link rel="apple-touch-icon" href="/apple-touch-icon-v2.png" />
  <link rel="icon" href="/arch-icon.svg" type="image/svg+xml" />
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
    @media (max-width: 640px) {
      .at-nav-links a:not(.at-nav-cta) { display: none; }
      .at-logo-name { font-size: 13px; }
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
      <a href="/dashboard">Dashboard</a>
      <a href="/login">Sign In</a>
      <a href="/docs">Docs</a>
      <a href="/signup" class="at-nav-cta">Get API Key →</a>
    </div>
  </nav>

  <div class="page">
    <div class="wrap">
      <div class="card">
        <div class="card-title">Get your API key</div>
        <p class="card-sub">Enter your email — your key is generated instantly. No email verification. No credit card. 100 free credits included, refreshed monthly.</p>

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
      const preCredits = parseInt(params.get('credits') || '100', 10);
      if (preKey && preKey.startsWith('arch_')) {
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
      showStatus(
        '<div style="margin-bottom:12px;font-size:17px;font-weight:800;color:#34d399">&#9989; Account created!</div>' +
        '<div style="margin-bottom:8px;font-size:12px;color:rgba(255,255,255,0.5)">Your API key — copy it now, it won&#39;t be shown again:</div>' +
        '<div id="api-key-box" class="mono" style="background:rgba(0,0,0,0.4);border:1px solid rgba(0,229,176,0.35);padding:10px 14px;border-radius:10px;word-break:break-all;font-size:13px;margin-bottom:12px;user-select:all;color:#e0ffe0">' + apiKey + '</div>' +
        '<button id="copy-btn" class="copy-btn-full">Copy API Key</button>' +
        '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:12px">You have <strong style="color:#f0f0f6">' + credits + ' free credits</strong>. Refreshed monthly. No subscription required.</div>' +
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
          showSuccess(data.api_key, data.credits || 100);
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
</body>
</html>`;
