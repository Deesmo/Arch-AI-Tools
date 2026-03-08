"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DASHBOARD_HTML = void 0;
exports.DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arch Tools — Dashboard</title>
  <link rel="apple-touch-icon" href="/apple-touch-icon-v2.png" />
  <link rel="icon" href="/arch-icon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #07061A;
      --card: rgba(255,255,255,0.05);
      --border: rgba(255,255,255,0.10);
      --text: rgba(255,255,255,0.92);
      --muted: rgba(255,255,255,0.55);
      --accent: #22d3ee;
      --grad: linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);
    }
    body {
      font-family: Syne, system-ui, sans-serif;
      background: radial-gradient(900px 500px at 20% 10%, rgba(85,34,255,0.14), transparent 65%),
                  radial-gradient(700px 400px at 85% 70%, rgba(255,24,136,0.10), transparent 65%),
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
      background: var(--bg); border: 1px solid rgba(255,255,255,0.12);
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
    /* ── LAYOUT ── */
    .page { max-width: 820px; margin: 0 auto; padding: 36px 20px; }
    .page-title { font-size: 28px; font-weight: 800; letter-spacing: -0.04em; margin-bottom: 6px; }
    .page-sub { font-size: 14px; color: var(--muted); margin-bottom: 28px; }
    .card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: 16px; padding: 22px; margin-bottom: 16px;
      backdrop-filter: blur(8px);
    }
    .card-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: var(--muted); text-transform: uppercase; margin-bottom: 14px; }
    /* ── API KEY ROW ── */
    .key-row { display: flex; gap: 10px; align-items: center; }
    .key-input {
      flex: 1; height: 44px; border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(0,0,0,0.3); color: var(--text);
      padding: 0 14px; font-family: "JetBrains Mono", monospace; font-size: 13px; outline: none;
    }
    .key-input:focus { border-color: rgba(34,211,238,0.5); box-shadow: 0 0 0 3px rgba(34,211,238,0.08); }
    .btn-load {
      height: 44px; padding: 0 20px; border-radius: 10px; border: 0;
      background: var(--grad); color: #fff; font-weight: 700; font-size: 14px;
      font-family: inherit; cursor: pointer; white-space: nowrap;
    }
    .status-tag { font-size: 12px; color: var(--muted); font-family: "JetBrains Mono", monospace; }
    /* ── STATS GRID ── */
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; }
    .stat-label { font-size: 11px; font-weight: 700; letter-spacing: 0.07em; color: var(--muted); text-transform: uppercase; margin-bottom: 8px; }
    .stat-val { font-size: 32px; font-weight: 800; letter-spacing: -0.04em; }
    .stat-unit { font-size: 13px; color: var(--muted); margin-left: 4px; font-weight: 400; }
    /* ── ACTIVITY ── */
    .activity-pre {
      font-family: "JetBrains Mono", monospace; font-size: 12px;
      color: rgba(255,255,255,0.7); white-space: pre-wrap; line-height: 1.7;
    }
    @media (max-width: 500px) {
      .stats-grid { grid-template-columns: 1fr; }
      .key-row { flex-direction: column; }
      .key-input, .btn-load { width: 100%; }
      .at-nav-links .at-nav-cta { display: none; }
    }
  </style>
</head>
<body>
  <nav class="at-nav">
    <a class="at-nav-logo" href="/">
      <div class="at-logo-mark">
        <svg width="18" height="18" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ng" x1="90" y1="20" x2="90" y2="160" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FFB030"/>
              <stop offset="42%" stop-color="#FF1888"/>
              <stop offset="100%" stop-color="#5522FF"/>
            </linearGradient>
          </defs>
          <path d="M90 22 L154 150 H128 L90 78 L52 150 H26 Z" fill="url(#ng)"/>
          <rect x="62" y="118" width="56" height="20" rx="4" fill="url(#ng)" opacity="0.6"/>
        </svg>
      </div>
      <span class="at-logo-name">Arch Tools</span>
    </a>
    <div class="at-nav-links">
      <a href="/">Home</a>
      <a href="/dashboard" style="color:var(--text)!important">Dashboard</a>
      <a href="/docs">Docs</a>
      <a href="/signup" class="at-nav-cta">Get API Key →</a>
    </div>
  </nav>

  <div class="page">
    <div class="page-title">Dashboard</div>
    <p class="page-sub">View your usage and remaining credits.</p>

    <div class="card">
      <div class="card-label">Your API Key</div>
      <div class="key-row">
        <input id="key" class="key-input" placeholder="arch_..." />
        <button id="load" class="btn-load">Load Usage</button>
        <span id="status" class="status-tag"></span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Credits Remaining</div>
        <div class="stat-val"><span id="credits">—</span><span class="stat-unit">credits</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Calls Today</div>
        <div class="stat-val"><span id="calls">—</span><span class="stat-unit">calls</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-label">Recent Activity</div>
      <pre id="recent" class="activity-pre">Load your API key above to see recent activity.</pre>
    </div>
  </div>

  <script>
    const btn = document.getElementById('load');

    btn.addEventListener('click', async () => {
      document.getElementById('status').textContent = 'Loading...';
      const raw = (document.getElementById('key').value || '').trim();
      let token = raw;
      if (token.toLowerCase().startsWith('authorization:')) token = token.replace(/^authorization:\\s*/i, '');
      if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim();
      if (!token) {
        document.getElementById('status').textContent = 'Enter your API key';
        return;
      }
      btn.disabled = true;
      try {
        const resp = await fetch('/v1/agent/usage', { headers: { Authorization: 'Bearer ' + token } });
        let data;
        try {
          data = await resp.json();
        } catch(_) {
          document.getElementById('status').textContent = '';
          document.getElementById('recent').textContent = resp.status >= 500
            ? 'Service temporarily unavailable — please try again in a moment.'
            : 'Unexpected server response (HTTP ' + resp.status + '). Try again.';
          return;
        }
        if (!resp.ok || data.ok === false) {
          document.getElementById('status').textContent = '';
          document.getElementById('recent').textContent = data.error === 'unauthorized'
            ? 'Invalid API key. Register at archtools.dev/signup to get a valid key.'
            : (data.message || 'Error loading usage.');
          return;
        }
        document.getElementById('status').textContent = '&#10003; Loaded';
        document.getElementById('credits').textContent = data.credits_remaining ?? '—';
        document.getElementById('calls').textContent = data.calls_today ?? '—';
        document.getElementById('recent').textContent = data.recent_activity && data.recent_activity.length
          ? JSON.stringify(data.recent_activity, null, 2)
          : 'No activity yet.';
      } catch(_) {
        document.getElementById('status').textContent = '';
        document.getElementById('recent').textContent = 'Could not connect. Check your internet connection and try again.';
      } finally {
        btn.disabled = false;
      }
    });

    // Auto-load AFTER event listener is attached
    (function() {
      const params = new URLSearchParams(window.location.search);
      const qKey = params.get('key');
      if (qKey && qKey.startsWith('arch_')) {
        document.getElementById('key').value = qKey;
        localStorage.setItem('arch_api_key', qKey);
        history.replaceState({}, '', '/dashboard');
        btn.click();
        return;
      }
      const saved = localStorage.getItem('arch_api_key');
      if (saved) {
        document.getElementById('key').value = saved;
        btn.click();
      }
    })();
  </script>
</body>
</html>`;
//# sourceMappingURL=dashboardHtml.js.map