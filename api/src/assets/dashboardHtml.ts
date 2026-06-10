export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arch Tools — Dashboard</title>
  <link rel="apple-touch-icon" href="/apple-touch-icon-v2.png" />
  <link rel="icon" href="/arch-icon.svg?v=2" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #07061A; --card: rgba(255,255,255,0.05); --border: rgba(255,255,255,0.10);
      --text: rgba(255,255,255,0.92); --muted: rgba(255,255,255,0.55);
      --accent: #22d3ee; --grad: linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);
      --green: #34d399;
    }
    body {
      font-family: Syne, system-ui, sans-serif;
      background: radial-gradient(900px 500px at 20% 10%, rgba(85,34,255,0.14), transparent 65%),
                  radial-gradient(700px 400px at 85% 70%, rgba(255,24,136,0.10), transparent 65%),
                  var(--bg);
      color: var(--text); min-height: 100vh;
    }
    /* NAV */
    .at-nav { display:flex; align-items:center; justify-content:space-between; padding:0 24px; height:60px; border-bottom:1px solid var(--border); backdrop-filter:blur(12px); background:rgba(7,6,26,0.85); position:sticky; top:0; z-index:100; }
    .at-nav-logo { display:flex; align-items:center; gap:9px; text-decoration:none; color:var(--text); }
    .at-logo-mark { width:32px; height:32px; border-radius:8px; background:var(--bg); border:1px solid rgba(255,255,255,0.12); display:grid; place-items:center; }
    .at-logo-name { font-weight:700; font-size:15px; letter-spacing:-0.02em; }
    .at-nav-links { display:flex; align-items:center; gap:24px; font-size:13px; }
    .at-nav-links a { color:var(--muted); text-decoration:none; transition:color 0.15s; }
    .at-nav-links a:hover { color:var(--text); }
    .at-nav-cta { background:var(--grad); color:#fff !important; font-weight:700; padding:7px 14px; border-radius:8px; font-size:12px !important; }
    /* LAYOUT */
    .page { max-width:860px; margin:0 auto; padding:36px 20px 80px; }
    .page-title { font-size:28px; font-weight:800; letter-spacing:-0.04em; margin-bottom:4px; }
    .page-sub { font-size:14px; color:var(--muted); margin-bottom:32px; }
    /* CARDS */
    .card { background:var(--card); border:1px solid var(--border); border-radius:16px; padding:22px 24px; margin-bottom:16px; backdrop-filter:blur(8px); }
    .card-label { font-size:11px; font-weight:700; letter-spacing:0.08em; color:var(--muted); text-transform:uppercase; margin-bottom:14px; }
    /* KEY SECTION */
    .key-entry-row { display:flex; gap:10px; margin-bottom:6px; }
    .key-input { flex:1; height:46px; border-radius:12px; border:1px solid var(--border); background:rgba(0,0,0,0.3); color:var(--text); padding:0 14px; font-family:"JetBrains Mono",monospace; font-size:13px; outline:none; }
    .key-input:focus { border-color:rgba(34,211,238,0.5); box-shadow:0 0 0 3px rgba(34,211,238,0.08); }
    .btn-load { height:46px; padding:0 22px; border-radius:12px; border:0; background:var(--grad); color:#fff; font-weight:700; font-size:14px; font-family:inherit; cursor:pointer; white-space:nowrap; transition:opacity 0.15s; }
    .btn-load:disabled { opacity:0.5; cursor:not-allowed; }
    /* MASKED KEY DISPLAY */
    .key-display { display:none; background:rgba(0,0,0,0.35); border:1px solid rgba(0,229,176,0.25); border-radius:12px; padding:14px 16px; margin-bottom:12px; }
    .key-display-row { display:flex; align-items:center; gap:10px; }
    .key-masked { font-family:"JetBrains Mono",monospace; font-size:13px; color:rgba(255,255,255,0.75); flex:1; letter-spacing:0.03em; word-break:break-all; }
    .key-actions { display:flex; gap:8px; flex-shrink:0; }
    .key-btn { height:34px; padding:0 12px; border-radius:8px; border:1px solid var(--border); background:rgba(255,255,255,0.07); color:var(--muted); font-size:12px; font-family:inherit; cursor:pointer; transition:all 0.12s; white-space:nowrap; }
    .key-btn:hover { background:rgba(255,255,255,0.12); color:var(--text); }
    .key-btn.copied { background:rgba(0,229,176,0.15); border-color:rgba(0,229,176,0.4); color:var(--green); }
    /* STATS */
    .stats-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:16px; }
    .stat-card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:18px 20px; }
    .stat-label { font-size:10px; font-weight:700; letter-spacing:0.08em; color:var(--muted); text-transform:uppercase; margin-bottom:8px; }
    .stat-val { font-size:30px; font-weight:800; letter-spacing:-0.04em; }
    .stat-val.green { color:var(--green); }
    .stat-unit { font-size:12px; color:var(--muted); margin-left:4px; font-weight:400; }
    /* ACTIVITY */
    .activity-empty { font-size:13px; color:var(--muted); font-style:italic; }
    .activity-row { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:13px; }
    .activity-row:last-child { border-bottom:none; }
    .activity-tool { font-family:"JetBrains Mono",monospace; color:var(--text); }
    .activity-time { color:var(--muted); font-size:12px; }
    .activity-credits { font-size:12px; color:#f87171; }
    /* UPGRADE BANNER */
    .upgrade-banner { background:rgba(255,176,48,0.08); border:1px solid rgba(255,176,48,0.25); border-radius:14px; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; }
    .upgrade-text { font-size:13px; color:rgba(255,255,255,0.7); }
    .upgrade-text strong { color:var(--text); }
    .btn-upgrade { height:38px; padding:0 18px; border-radius:10px; border:0; background:var(--grad); color:#fff; font-weight:700; font-size:13px; font-family:inherit; cursor:pointer; white-space:nowrap; text-decoration:none; display:inline-flex; align-items:center; }
    /* STATUS */
    .status-tag { font-size:12px; color:var(--muted); font-family:"JetBrains Mono",monospace; }
    @media (max-width:600px) {
      .stats-grid { grid-template-columns:1fr 1fr; }
      .key-entry-row { flex-direction:column; }
      .btn-load { width:100%; }
      .at-nav-links .at-nav-cta { display:none; }
    }
    @media (max-width:400px) { .stats-grid { grid-template-columns:1fr; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    /* HAMBURGER */
    .hamburger { display:none; background:none; border:none; cursor:pointer; padding:6px; }
    .hamburger svg { width:24px; height:24px; stroke:var(--text); stroke-width:2; stroke-linecap:round; }
    .mobile-menu { display:none; flex-direction:column; gap:6px; padding:12px 24px 16px; border-bottom:1px solid var(--border); background:rgba(7,6,26,0.95); }
    .mobile-menu a { color:var(--muted); text-decoration:none; font-size:14px; padding:8px 0; }
    .mobile-menu a:hover { color:var(--text); }
    .mobile-menu.open { display:flex; }
    @media (max-width:768px) {
      .at-nav-links { display:none; }
      .hamburger { display:block; }
    }
  </style>
</head>
<body>
  <nav class="at-nav">
    <a class="at-nav-logo" href="/">
      <div class="at-logo-mark">
        <svg viewBox="0 10 100 90" overflow="visible" width="28" height="28"><defs><linearGradient id="arch-grad-nav-db" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF9010"/><stop offset="60%" stop-color="#FF2896"/><stop offset="100%" stop-color="#8844FF"/></linearGradient><filter id="arch-neon-nav-db"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path fill="url(#arch-grad-nav-db)" filter="url(#arch-neon-nav-db)" d="M15,100L15,55A35,35,0,0,1,85,55L85,100L74,100L74,55A24,24,0,0,0,26,55L26,100Z M34,100L34,55A16,16,0,0,1,66,55L66,100L58,100L58,55A8,8,0,0,0,42,55L42,100Z"/></svg>
      </div>
      <span class="at-logo-name">Arch Tools</span>
    </a>
    <div class="at-nav-links">
      <a href="/">Home</a>
      <a href="/docs">Docs</a>
      <a href="/changelog">Changelog</a>
      <a href="/#pricing">Pricing</a>
      <a href="/signup" class="at-nav-cta">Get API Key</a>
      <a href="#" id="nav-signout" onclick="doSignOut();return false;" style="color:#f87171;font-size:13px;">Sign Out</a>
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
    <a href="#" onclick="doSignOut();return false;" style="color:#f87171;">Sign Out</a>
  </div>

  <div class="page">
    <div class="page-title">Dashboard</div>
    <p class="page-sub">Monitor your API usage and manage your account.</p>

    <!-- LOADING STATE (shown while auto-init runs) -->
    <div id="loading-card" class="card" style="text-align:center;padding:36px 24px;">
      <div style="font-size:13px;color:var(--muted);margin-bottom:8px;">Signing you in…</div>
      <div style="width:32px;height:32px;border:3px solid rgba(255,255,255,0.1);border-top-color:var(--accent);border-radius:50%;animation:spin 0.7s linear infinite;margin:0 auto;"></div>
    </div>

    <!-- API KEY ENTRY (hidden by default — only shown as last resort fallback) -->
    <div id="key-entry-card" class="card" style="display:none;">
      <div class="card-label">API Key</div>
      <div class="key-entry-row">
        <input id="key-input" class="key-input" placeholder="arch_..." autocomplete="off" />
        <button id="load-btn" class="btn-load">Load</button>
        <span id="status-tag" class="status-tag"></span>
      </div>
      <div style="font-size:12px;color:var(--muted)">Don&#39;t have a key? <a href="/signup" style="color:var(--accent)">Get one free →</a></div>
    </div>

    <!-- MASKED KEY DISPLAY (shown after load) -->
    <div id="key-display" class="key-display">
      <div class="card-label" style="margin-bottom:10px">Your API Key</div>
      <div class="key-display-row">
        <span id="key-masked" class="key-masked"></span>
        <div class="key-actions">
          <button id="key-toggle" class="key-btn">&#128065; Show</button>
          <button id="key-copy" class="key-btn">&#128203; Copy</button>
        </div>
      </div>
    </div>

    <!-- STATS -->
    <div id="stats-section" style="display:none">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Credits Remaining</div>
          <div class="stat-val green"><span id="credits">—</span><span class="stat-unit">cr</span></div>
          <a href="/pricing" style="display:inline-block;margin-top:8px;font-size:11px;color:var(--accent);text-decoration:none;font-weight:600;letter-spacing:0.02em">Get more credits →</a>
        </div>
        <div class="stat-card">
          <div class="stat-label">Calls Today</div>
          <div class="stat-val"><span id="calls-today">—</span><span class="stat-unit">calls</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Calls</div>
          <div class="stat-val"><span id="calls-total">—</span><span class="stat-unit">all time</span></div>
        </div>
      </div>

      <!-- UPGRADE BANNER (shown when credits low) -->
      <div id="upgrade-banner" class="upgrade-banner" style="display:none">
        <div class="upgrade-text">Running low on credits. <strong>Buy more and never get cut off.</strong></div>
        <a href="/fund" class="btn-upgrade">Add Credits →</a>
      </div>

      <!-- ACTIVITY -->
      <div class="card">
        <div class="card-label">Recent Activity</div>
        <div id="activity-list"><p class="activity-empty">No API calls yet. <a href="/docs" style="color:var(--accent)">Try a tool →</a></p></div>
      </div>

      <!-- QUICK START -->
      <div class="card">
        <div class="card-label">Quick Start</div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:12px">Make your first API call with your key:</p>
        <pre id="quickstart-code" style="background:rgba(0,0,0,0.4);border:1px solid var(--border);border-radius:10px;padding:14px;font-family:JetBrains Mono,monospace;font-size:12px;color:rgba(255,255,255,0.8);overflow-x:auto;line-height:1.6">curl -X POST https://archtools.dev/v1/tools/generate-hash \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d &#39;{"text":"hello world","algorithm":"sha256"}&#39;</pre>
      </div>

      <!-- SET PASSWORD -->
      <div class="card" id="set-password-card" style="display:none;">
        <div class="card-label">Set Login Password</div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">Set a password to sign in with email next time — no need to enter your API key.</p>
        <div style="display:flex;gap:10px;margin-bottom:8px;">
          <input id="new-password" type="password" placeholder="New password (min 8 chars)" style="flex:1;height:42px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.92);padding:0 14px;font-family:inherit;font-size:13px;outline:none;" />
          <button onclick="setPassword()" style="height:42px;padding:0 18px;border-radius:10px;border:0;background:linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);color:#fff;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;white-space:nowrap;">Set Password</button>
        </div>
        <div id="pw-status" style="font-size:12px;min-height:16px;"></div>
      </div>
    </div>

  </div>

  <script>
    function doSignOut() {
      sessionStorage.removeItem("arch_api_key");
      try { localStorage.removeItem("arch_api_key"); } catch(_) {}
      window.location.href = "/auth/logout";
    }

    var fullKey = "";
    var keyVisible = false;

    function maskKey(k) {
      if (!k || k.length < 12) return k;
      return k.slice(0, 7) + "\u2022".repeat(Math.min(32, k.length - 11)) + k.slice(-6);
    }

    function setStatus(msg, color) {
      var el = document.getElementById("status-tag");
      el.textContent = msg;
      el.style.color = color || "rgba(255,255,255,0.4)";
    }

    document.getElementById("load-btn").addEventListener("click", loadDashboard);
    document.getElementById("key-input").addEventListener("keydown", function(e) {
      if (e.key === "Enter") loadDashboard();
    });

    document.getElementById("key-toggle").addEventListener("click", function() {
      keyVisible = !keyVisible;
      document.getElementById("key-masked").textContent = keyVisible ? fullKey : maskKey(fullKey);
      this.textContent = keyVisible ? "\u{1F576}\uFE0F Hide" : "\u{1F441} Show";
    });

    document.getElementById("key-copy").addEventListener("click", function() {
      var btn = this;
      navigator.clipboard.writeText(fullKey).then(function() {
        btn.textContent = "\u2713 Copied!";
        btn.classList.add("copied");
        setTimeout(function() { btn.textContent = "\u{1F4CB} Copy"; btn.classList.remove("copied"); }, 2000);
      });
    });

    async function loadDashboard() {
      var raw = (document.getElementById("key-input").value || "").trim();
      var token = raw.replace(/^authorization:\\s*/i, "").replace(/^bearer /i, "").trim();
      
      var btn = document.getElementById("load-btn");
      btn.disabled = true; btn.textContent = "Loading\u2026";
      setStatus("", "");
      
      try {
        var resp = await fetch("/v1/agent/usage", { headers: { Authorization: "Bearer " + token } });
        var data;
        try { data = await resp.json(); } catch(_) {
          setStatus(resp.status >= 500 ? "Service unavailable \u2014 try again" : "Server error (" + resp.status + ")", "#f87171");
          return;
        }
        if (!resp.ok || data.ok === false) {
          setStatus(data.error === "unauthorized" ? "\u274C Invalid key" : (data.message || "Error"), "#f87171");
          showKeyEntryFallback();
          return;
        }

        fullKey = token;
        if (token) { sessionStorage.setItem("arch_api_key", token); try { localStorage.setItem("arch_api_key", token); } catch(_) {} }
        setStatus("\u2713 Loaded", "var(--green)");

        // Show masked key
        var kd = document.getElementById("key-display");
        kd.style.display = "block";
        document.getElementById("key-masked").textContent = maskKey(token);

        // Show stats
        var ss = document.getElementById("stats-section");
        ss.style.display = "block";
        document.getElementById("credits").textContent = (data.credits_remaining ?? 0).toLocaleString();
        document.getElementById("calls-today").textContent = data.calls_today ?? 0;
        document.getElementById("calls-total").textContent = (data.total_calls ?? 0).toLocaleString();

        // Upgrade banner if low
        var cr = data.credits_remaining ?? 0;
        if (cr < 20) document.getElementById("upgrade-banner").style.display = "flex";

        // Activity
        var act = data.recent_activity || [];
        var al = document.getElementById("activity-list");
        if (act.length === 0) {
          al.innerHTML = '<p class="activity-empty">No API calls yet. <a href="/docs" style="color:var(--accent)">Try a tool \u2192</a></p>';
        } else {
          al.innerHTML = act.slice(0, 10).map(function(a) {
            var ts = a.createdAt || a.created_at || "";
            var d = ts ? new Date(ts).toLocaleTimeString() : "";
            var credits = a.creditsUsed || a.credits_used || 0;
            var cr = credits ? '<span class="activity-credits">-' + credits + ' cr</span>' : '';
            var toolName = a.toolName || a.tool || 'api call';
            return '<div class="activity-row"><span class="activity-tool">' + toolName + '</span><span>' + cr + ' <span class="activity-time">' + d + '</span></span></div>';
          }).join("");
        }

        // Update quickstart with actual key
        var qs = document.getElementById("quickstart-code");
        var displayKey = maskKey(token);
        var SQ = String.fromCharCode(39);
        var BSNL = String.fromCharCode(92, 10) + '  ';
        qs.textContent = 'curl -X POST https://archtools.dev/v1/tools/generate-hash' + BSNL + '-H "x-api-key: ' + displayKey + '"' + BSNL + '-H "Content-Type: application/json"' + BSNL + '-d ' + SQ + '{"text":"hello world","algorithm":"sha256"}' + SQ;

        // Hide the key entry card entirely after successful load
        document.getElementById("key-entry-card").style.display = "none";
        document.getElementById("loading-card").style.display = "none";
        // Show set-password card only if not already logged in via session
        fetch("/auth/me", { credentials: "include" }).then(r => r.json()).then(function(me) {
          if (!me.ok) document.getElementById("set-password-card").style.display = "block";
        }).catch(function() { document.getElementById("set-password-card").style.display = "block"; });

      } catch(_) {
        setStatus("Connection error", "#f87171");
        showKeyEntryFallback();
      } finally {
        btn.disabled = false; btn.textContent = "Load";
      }
    }

    function showKeyEntryFallback() {
      document.getElementById("loading-card").style.display = "none";
      document.getElementById("key-entry-card").style.display = "block";
    }

    // Auto-load: session-first, no manual key entry for logged-in users
    // Loop-breaker: track if we already attempted auth this page load
    var _authAttempted = sessionStorage.getItem("_dash_auth_attempt") === "1";
    setTimeout(async function() {
      var params = new URLSearchParams(window.location.search);
      var qKey = params.get("key");
      if (qKey && qKey.startsWith("arch_")) {
        // Consume key from URL immediately — strip from history so it never leaks
        history.replaceState({}, "", "/dashboard");
        sessionStorage.setItem("arch_api_key", qKey);
        try { localStorage.setItem("arch_api_key", qKey); } catch(_) {}
        document.getElementById("key-input").value = qKey;
        document.getElementById("loading-card").style.display = "none";
        await loadDashboard();
        return;
      }
      // Primary: session cookie — this is the normal path after email/password login
      try {
        var meResp = await fetch("/auth/me", { credentials: "include" });
        if (meResp.ok) {
          var me = await meResp.json();
          if (me.ok) {
            // Sentinel fix: clear stale localStorage key before loading session key
            // Prevents cross-account key bleed if /auth/api-key fails transiently
            sessionStorage.removeItem("arch_api_key");
            try { localStorage.removeItem("arch_api_key"); } catch(_) {}
            try {
              var keyResp = await fetch("/auth/api-key", { credentials: "include" });
              if (keyResp.ok) {
                var kd = await keyResp.json();
                if (kd.ok && kd.api_key) {
                  document.getElementById("key-input").value = kd.api_key;
                  sessionStorage.setItem("arch_api_key", kd.api_key);
                  try { localStorage.setItem("arch_api_key", kd.api_key); } catch(_) {}
                  document.getElementById("loading-card").style.display = "none";
                  sessionStorage.removeItem("_dash_auth_attempt");
                  await loadDashboard();
                  return;
                }
              }
            } catch(_) {}
            // Session valid but /auth/api-key failed — show error, do NOT fall to stale localStorage
            document.getElementById("loading-card").style.display = "none";
            showKeyEntryFallback();
            document.getElementById("status-tag").textContent = "Session error — enter your API key";
            document.getElementById("status-tag").style.color = "#f87171";
            return;
          }
        }
      } catch(_) {}
      // Secondary: localStorage (returning users who used API key tab, no active session)
      var saved = sessionStorage.getItem("arch_api_key");
      if (!saved) { try { saved = localStorage.getItem("arch_api_key"); } catch(_) {} }
      if (saved) {
        document.getElementById("key-input").value = saved;
        document.getElementById("loading-card").style.display = "none";
        await loadDashboard();
        return;
      }
      // No session + no saved key: redirect to login
      // Loop-breaker: if we already redirected once this tab session, show error instead of looping
      if (_authAttempted) {
        document.getElementById("loading-card").style.display = "none";
        showKeyEntryFallback();
        document.getElementById("status-tag").textContent = "Session expired — please sign in again";
        document.getElementById("status-tag").style.color = "#f87171";
        return;
      }
      sessionStorage.setItem("_dash_auth_attempt", "1");
      window.location.href = '/login?next=/dashboard';
    }, 0);

    async function setPassword() {
      var pw = (document.getElementById("new-password").value || "").trim();
      var statusEl = document.getElementById("pw-status");
      if (!pw || pw.length < 8) { statusEl.style.color="#f87171"; statusEl.textContent="Password must be at least 8 characters."; return; }
      if (!fullKey) { statusEl.style.color="#f87171"; statusEl.textContent="Load your API key first."; return; }
      statusEl.style.color="var(--muted)"; statusEl.textContent="Setting password…";
      try {
        var r = await fetch("/auth/set-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ api_key: fullKey, password: pw })
        });
        var d = await r.json();
        if (d.ok) {
          statusEl.style.color="var(--green)"; statusEl.textContent="✓ Password set — you can now sign in with email & password.";
          document.getElementById("set-password-card").style.border = "1px solid rgba(0,229,176,0.3)";
          document.getElementById("new-password").value = "";
        } else {
          statusEl.style.color="#f87171"; statusEl.textContent = d.message || "Something went wrong.";
        }
      } catch(_) {
        statusEl.style.color="#f87171"; statusEl.textContent="Connection error. Try again.";
      }
    }
  </script>
<!-- Arch Tools Chat Widget --><style>#arch-chat-bubble{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);border:none;cursor:pointer;z-index:99999;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(85,34,255,0.4);transition:transform .2s,box-shadow .2s}#arch-chat-bubble:hover{transform:scale(1.1);box-shadow:0 6px 32px rgba(85,34,255,0.6)}#arch-chat-bubble svg{width:28px;height:28px;fill:#fff}#arch-chat-window{position:fixed;bottom:92px;right:24px;width:380px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#0c0b1e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;z-index:99999;display:none;flex-direction:column;overflow:hidden;box-shadow:0 8px 48px rgba(0,0,0,0.6);font-family:'JetBrains Mono',monospace}#arch-chat-window.open{display:flex}#arch-chat-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:linear-gradient(135deg,rgba(85,34,255,0.15),rgba(255,24,136,0.1));border-bottom:1px solid rgba(255,255,255,0.08)}#arch-chat-header .ach-title{font-size:14px;font-weight:600;color:#fff;display:flex;align-items:center;gap:8px}#arch-chat-header .ach-title .ach-dot{width:8px;height:8px;border-radius:50%;background:#34d399;animation:ach-pulse 2s infinite}@keyframes ach-pulse{0%,100%{opacity:1}50%{opacity:.4}}#arch-chat-close{background:none;border:none;color:rgba(255,255,255,0.5);font-size:20px;cursor:pointer;padding:4px 8px;line-height:1}#arch-chat-close:hover{color:#fff}#arch-chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}#arch-chat-messages::-webkit-scrollbar{width:4px}#arch-chat-messages::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:4px}.ach-msg{max-width:85%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}.ach-msg.bot{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.88);border-bottom-left-radius:4px;align-self:flex-start}.ach-msg.user{background:linear-gradient(135deg,#5522FF,#FF1888);color:#fff;border-bottom-right-radius:4px;align-self:flex-end}.ach-typing{display:flex;gap:4px;padding:10px 14px;align-self:flex-start}.ach-typing span{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.3);animation:ach-bounce .6s infinite alternate}.ach-typing span:nth-child(2){animation-delay:.2s}.ach-typing span:nth-child(3){animation-delay:.4s}@keyframes ach-bounce{to{opacity:1;transform:translateY(-4px)}}#arch-chat-input-row{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(7,6,26,0.8)}#arch-chat-input{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:#fff;font-size:13px;font-family:'JetBrains Mono',monospace;outline:none;resize:none}#arch-chat-input::placeholder{color:rgba(255,255,255,0.3)}#arch-chat-input:focus{border-color:rgba(85,34,255,0.5)}#arch-chat-send{background:linear-gradient(135deg,#5522FF,#FF1888);border:none;border-radius:8px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .2s}#arch-chat-send:hover{opacity:.85}#arch-chat-send:disabled{opacity:.4;cursor:not-allowed}#arch-chat-send svg{width:18px;height:18px;fill:#fff}@media(max-width:480px){#arch-chat-window{bottom:0;right:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}}</style><button id="arch-chat-bubble" aria-label="Open chat" onclick="archChatToggle()"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg></button><div id="arch-chat-window"><div id="arch-chat-header"><div class="ach-title"><div class="ach-dot"></div>Arch Tools Support</div><button id="arch-chat-close" onclick="archChatToggle()" aria-label="Close chat">&times;</button></div><div id="arch-chat-messages"><div class="ach-msg bot">Hey! 👋 I'm the Arch Tools assistant. Ask me about our API, pricing, MCP setup, x402 payments, or anything else!</div></div><div id="arch-chat-input-row"><input type="text" id="arch-chat-input" placeholder="Ask about Arch Tools..." maxlength="2000" autocomplete="off" /><button id="arch-chat-send" onclick="archChatSend()" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div></div><script>(function(){var chatHistory=[],sending=false;window.archChatToggle=function(){var w=document.getElementById('arch-chat-window');w.classList.toggle('open');if(w.classList.contains('open'))document.getElementById('arch-chat-input').focus()};function addMsg(text,role){var msgs=document.getElementById('arch-chat-messages'),d=document.createElement('div');d.className='ach-msg '+(role==='user'?'user':'bot');d.textContent=text;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;chatHistory.push({role:role,content:text});if(chatHistory.length>20)chatHistory=chatHistory.slice(-20)}function showTyping(){var msgs=document.getElementById('arch-chat-messages'),t=document.createElement('div');t.className='ach-typing';t.id='ach-typing-ind';t.innerHTML='<span></span><span></span><span></span>';msgs.appendChild(t);msgs.scrollTop=msgs.scrollHeight}function hideTyping(){var t=document.getElementById('ach-typing-ind');if(t)t.remove()}window.archChatSend=function(){if(sending)return;var inp=document.getElementById('arch-chat-input'),msg=inp.value.trim();if(!msg)return;inp.value='';addMsg(msg,'user');sending=true;document.getElementById('arch-chat-send').disabled=true;showTyping();fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,history:chatHistory.slice(0,-1)})}).then(function(r){return r.json()}).then(function(d){hideTyping();if(d.ok&&d.reply)addMsg(d.reply,'assistant');else addMsg('Sorry, something went wrong. Please try again.','assistant')}).catch(function(){hideTyping();addMsg('Connection error. Please try again.','assistant')}).finally(function(){sending=false;document.getElementById('arch-chat-send').disabled=false})};document.addEventListener('keydown',function(e){if(e.key==='Enter'&&document.activeElement===document.getElementById('arch-chat-input')&&!e.shiftKey){e.preventDefault();archChatSend()}})})();</script>
</body>
</html>`;
