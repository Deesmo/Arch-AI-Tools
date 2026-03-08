"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DASHBOARD_HTML = void 0;
exports.DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arch Tools — Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#030308;--card:#0c0c16;--border:rgba(255,255,255,.08);--text:#f0f0f6;--muted:#8b8ba6;--accent:#00e5b0;}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Instrument Sans',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
    .wrap{max-width:980px;margin:0 auto;padding:28px 18px 64px}
    header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
    a{color:var(--muted);text-decoration:none}
    a:hover{color:var(--text)}
    .card{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:16px;padding:18px}
    .row{display:grid;grid-template-columns:1fr;gap:12px}
    @media(min-width:860px){.row{grid-template-columns:1fr 1fr}}
    input{width:100%;padding:12px 12px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:13px}
    button{padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--accent);color:#000;font-weight:700;cursor:pointer}
    button:hover{opacity:.9}
    .kpi{display:flex;gap:12px;align-items:flex-end}
    .kpi b{font-size:28px;letter-spacing:-.5px}
    .mono{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)}
    pre{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.35);border:1px solid var(--border);border-radius:12px;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12px}
    .muted{color:var(--muted)}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <div class="mono">Arch Tools</div>
        <h1 style="font-size:22px;letter-spacing:-.6px">Dashboard</h1>
      </div>
      <div class="mono"><a href="/">Home</a> · <a href="/docs">Docs</a> · <a href="/signup">Signup</a></div>
    </header>

    <div class="card" style="margin-bottom:14px">
      <div class="muted" style="margin-bottom:10px">Paste your API key to view usage.</div>
      <div class="row">
        <div>
          <input id="key" placeholder="arch_..." />
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button id="load">Load Usage</button>
          <div class="mono" id="status"></div>
        </div>
      </div>
    </div>

    <div class="row" style="margin-bottom:14px">
      <div class="card">
        <div class="mono">Credits Remaining</div>
        <div class="kpi"><b id="credits">—</b><span class="muted">credits</span></div>
      </div>
      <div class="card">
        <div class="mono">Calls Today</div>
        <div class="kpi"><b id="calls">—</b><span class="muted">calls</span></div>
      </div>
    </div>

    <div class="card">
      <div class="mono" style="margin-bottom:10px">Recent Activity</div>
      <pre id="recent">—</pre>
    </div>

    <script>
      const $ = (id) => document.getElementById(id);

      const btn = $('load');
      btn.addEventListener('click', async () => {
        $('status').textContent = 'Loading…';
        const raw = $('key').value.trim();
        // Strip any header prefix users might have accidentally pasted
        let token = raw;
        if (token.toLowerCase().startsWith('authorization:')) token = token.replace(/^authorization:\s*/i, '');
        if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim();
        try {
          const resp = await fetch('/v1/agent/usage', { headers: { Authorization: 'Bearer ' + token } });
          const data = await resp.json();
          if (!resp.ok || data.ok === false) {
            $('status').textContent = 'Error';
            $('recent').textContent = JSON.stringify(data, null, 2);
            return;
          }
          $('status').textContent = 'OK';
          $('credits').textContent = data.credits_remaining ?? '—';
          $('calls').textContent = data.calls_today ?? '—';
          $('recent').textContent = JSON.stringify(data.recent_activity ?? [], null, 2);
        } catch (e) {
          $('status').textContent = 'Failed';
          $('recent').textContent = String(e);
        }
      });

      // Auto-load AFTER event listener is attached
      (function() {
        const params = new URLSearchParams(window.location.search);
        const qKey = params.get('key');
        if (qKey && qKey.startsWith('arch_')) {
          $('key').value = qKey;
          localStorage.setItem('arch_api_key', qKey);
          history.replaceState({}, '', '/dashboard');
          btn.click();
          return;
        }
        const saved = localStorage.getItem('arch_api_key');
        if (saved) {
          $('key').value = saved;
          btn.click();
        }
      })();
    </script>
  </div>
</body>
</html>`;
//# sourceMappingURL=dashboardHtml.js.map