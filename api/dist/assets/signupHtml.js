"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIGNUP_HTML = void 0;
exports.SIGNUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arch Tools — Get your API key</title>
  <meta name="description" content="Create your Arch Tools account. Verify your email to receive your API key and free monthly credits." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card: rgba(255,255,255,0.06);
      --border: rgba(255,255,255,0.12);
      --text: rgba(255,255,255,0.92);
      --muted: rgba(255,255,255,0.70);
      --accent: #22d3ee;
      --accent2: #4f46e5;
      --shadow: 0 18px 60px rgba(0,0,0,0.55);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: radial-gradient(1200px 600px at 30% 15%, rgba(79,70,229,0.22), transparent 60%),
                  radial-gradient(900px 500px at 80% 30%, rgba(34,211,238,0.18), transparent 60%),
                  var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 28px 16px;
    }
    .wrap { width: 100%; max-width: 520px; }
    .brand {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 18px;
    }
    .mark {
      width: 38px; height: 38px; border-radius: 10px;
      display: grid; place-items: center;
      background: linear-gradient(135deg, rgba(79,70,229,0.95), rgba(34,211,238,0.95));
      font-weight: 800;
    }
    .name { font-weight: 700; letter-spacing: -0.02em; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 22px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }
    h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: -0.03em; }
    p { margin: 0 0 18px; color: var(--muted); line-height: 1.5; }
    .row { display: flex; gap: 10px; }
    input {
      flex: 1;
      height: 44px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(0,0,0,0.25);
      color: var(--text);
      padding: 0 14px;
      outline: none;
      font-size: 14px;
    }
    input:focus { border-color: rgba(34,211,238,0.55); box-shadow: 0 0 0 4px rgba(34,211,238,0.10); }
    button {
      height: 44px;
      border-radius: 12px;
      border: 0;
      padding: 0 14px;
      font-weight: 700;
      cursor: pointer;
      color: #071018;
      background: linear-gradient(135deg, var(--accent2), var(--accent));
      transition: transform 0.08s ease;
      white-space: nowrap;
    }
    button:active { transform: translateY(1px); }
    .fine {
      margin-top: 14px;
      font-size: 12px;
      color: rgba(255,255,255,0.62);
    }
    .fine a { color: rgba(255,255,255,0.82); text-decoration: none; }
    .fine a:hover { text-decoration: underline; }
    .status {
      margin-top: 14px;
      padding: 12px 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(0,0,0,0.18);
      color: var(--muted);
      display: none;
    }
    .status strong { color: var(--text); }
    .mono { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <div class="mark">A</div>
      <div class="name">Arch Tools</div>
    </div>

    <div class="card">
      <h1>Get your API key</h1>
      <p>Enter your email to create an account. Your API key is generated instantly — <strong>copy and save it</strong>, it won't be shown again. New accounts receive <strong>100 free credits</strong> to get started.</p>

      <div class="row">
        <input id="email" type="email" placeholder="you@company.com" autocomplete="email" />
        <button id="btn">Get API Key</button>
      </div>

      <div id="status" class="status"></div>

      <div class="fine">
        By continuing you agree to our <a href="/legal/terms">Terms</a> and <a href="/legal/privacy">Privacy Policy</a>.
      </div>
    </div>

    <div class="fine" style="margin-top:14px; text-align:center;">
      <a href="/">← Back to home</a> · <a href="/docs">Docs</a>
    </div>
  </div>

  <script>
    const statusEl = document.getElementById('status');
    const btn = document.getElementById('btn');

    // If redirected from homepage registration with key in URL, show success immediately
    (function() {
      const params = new URLSearchParams(window.location.search);
      const preKey = params.get('key');
      const preCredits = parseInt(params.get('credits') || '100', 10);
      if (preKey && preKey.startsWith('arch_')) {
        showStatus(
          '<div style="margin-bottom:10px;font-size:16px;font-weight:700;color:#00e5b0">✅ Account created!</div>' +
          '<div style="margin-bottom:6px;font-size:12px;color:#8b8ba6">Your API key — save it now, it won\'t be shown again:</div>' +
          '<div id="api-key-box" class="mono" style="background:#0a0a14;border:1px solid rgba(0,229,176,0.4);padding:10px 12px;border-radius:8px;cursor:text;word-break:break-all;font-size:13px;margin-bottom:10px;user-select:all">' + preKey + '</div>' +
          '<button id="copy-btn" style="width:100%;height:40px;border-radius:10px;border:0;background:linear-gradient(135deg,#4f46e5,#22d3ee);color:#071018;font-weight:700;cursor:pointer;margin-bottom:10px">Copy API Key</button>' +
          '<div style="font-size:12px;color:#8b8ba6">You have <strong style="color:#f0f0f6">' + preCredits + ' free credits</strong>. This key won\'t be shown again — save it somewhere safe.</div>' +
          '<div style="margin-top:10px"><a href="/dashboard?key=' + encodeURIComponent(preKey) + '" style="color:#00e5b0;font-weight:600">→ Open Dashboard</a></div>'
        );
        const copyBtn = document.getElementById('copy-btn');
        if (copyBtn) {
          copyBtn.addEventListener('click', function() {
            navigator.clipboard.writeText(preKey).then(function() {
              copyBtn.textContent = '✅ Copied!';
              setTimeout(function() { copyBtn.textContent = 'Copy API Key'; }, 2000);
            });
          });
        }
        btn.style.display = 'none';
        document.getElementById('email').style.display = 'none';
        // Clean URL so key isn't visible in address bar
        history.replaceState({}, '', '/signup');
        return;
      }
    })();

    document.getElementById('btn').addEventListener('click', sendLink);

    function showStatus(html) {
      statusEl.innerHTML = html;
      statusEl.style.display = 'block';
    }

    async function sendLink() {
      const email = (document.getElementById('email').value || '').trim();
      if (!email) {
        showStatus('<strong>Enter an email</strong> to continue.');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Creating account…';

      try {
        const res = await fetch('/v1/agent/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, plan: 'free' })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.api_key) {
          const apiKey = data.api_key;
          const credits = data.credits || 100;
          showStatus(
            '<div style="margin-bottom:10px;font-size:16px;font-weight:700;color:#00e5b0">✅ Account created!</div>' +
            '<div style="margin-bottom:6px;font-size:12px;color:#8b8ba6">Your API key — save it now, it won&#39;t be shown again:</div>' +
            '<div id="api-key-box" class="mono" style="background:#0a0a14;border:1px solid rgba(0,229,176,0.4);padding:10px 12px;border-radius:8px;cursor:text;word-break:break-all;font-size:13px;margin-bottom:10px;user-select:all">' + apiKey + '</div>' +
            '<button id="copy-btn" style="width:100%;height:40px;border-radius:10px;border:0;background:linear-gradient(135deg,#4f46e5,#22d3ee);color:#071018;font-weight:700;cursor:pointer;margin-bottom:10px">Copy API Key</button>' +
            '<div style="font-size:12px;color:#8b8ba6">You have <strong style="color:#f0f0f6">' + credits + ' free credits</strong>. This key won&#39;t be shown again — save it somewhere safe.</div>' +
            '<div style="margin-top:10px"><a href="/dashboard" style="color:#00e5b0;font-weight:600">→ Open Dashboard</a></div>'
          );
          const copyBtn = document.getElementById('copy-btn');
          if (copyBtn) {
            copyBtn.addEventListener('click', function() {
              navigator.clipboard.writeText(apiKey).then(function() {
                copyBtn.textContent = '✅ Copied!';
                setTimeout(function() { copyBtn.textContent = 'Copy API Key'; }, 2000);
              });
            });
          }
          btn.style.display = 'none';
          document.getElementById('email').style.display = 'none';
        } else {
          const msg = data.error === 'email_exists'
            ? 'An account with this email already exists. <a href="/dashboard" style="color:#00e5b0">→ Go to Dashboard</a>'
            : (data.message || 'Something went wrong. Please try again.');
          showStatus('<div style="color:#f87171;font-weight:600">⚠️ ' + msg + '</div>');
        }
      } catch (e) {
        showStatus('<strong>Something went wrong.</strong> Please try again.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Get API Key';
      }
    }
  </script>
</body>
</html>`;
//# sourceMappingURL=signupHtml.js.map