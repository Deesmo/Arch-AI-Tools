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
      --bg: #07061A; --card: rgba(255,255,255,0.05); --border: rgba(255,255,255,0.10);
      --text: rgba(255,255,255,0.92); --muted: rgba(255,255,255,0.55);
      --accent: #22d3ee; --grad: linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);
      --green: #00e5b0;
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
  </style>
</head>
<body>
  <nav class="at-nav">
    <a class="at-nav-logo" href="/">
      <div class="at-logo-mark">
        <svg width="18" height="18" viewBox="0 0 180 180" fill="none"><defs><linearGradient id="ng" x1="90" y1="20" x2="90" y2="160" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FFB030"/><stop offset="42%" stop-color="#FF1888"/><stop offset="100%" stop-color="#5522FF"/></linearGradient></defs><path d="M90 22 L154 150 H128 L90 78 L52 150 H26 Z" fill="url(#ng)"/><rect x="62" y="118" width="56" height="20" rx="4" fill="url(#ng)" opacity="0.6"/></svg>
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
    <p class="page-sub">Monitor your API usage and manage your account.</p>

    <!-- API KEY ENTRY -->
    <div class="card">
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
        <a href="/#pricing" class="btn-upgrade">Buy Credits →</a>
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
    </div>

  </div>

  <script>
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
      if (!token) { setStatus("Enter your API key", ""); return; }
      
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
          return;
        }

        fullKey = token;
        if (token) localStorage.setItem("arch_api_key", token);
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
        qs.textContent = 'curl -X POST https://archtools.dev/v1/tools/generate-hash \\\n  -H "x-api-key: ' + displayKey + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'{{"text":"hello world","algorithm":"sha256"}}\'';

        // Hide input after success
        document.getElementById("key-input").style.display = "none";
        document.getElementById("load-btn").style.display = "none";

      } catch(_) {
        setStatus("Connection error", "#f87171");
      } finally {
        btn.disabled = false; btn.textContent = "Load";
      }
    }

    // Auto-load: try session cookie first, then URL param, then localStorage
    (async function() {
      var params = new URLSearchParams(window.location.search);
      var qKey = params.get("key");
      if (qKey && qKey.startsWith("arch_")) {
        document.getElementById("key-input").value = qKey;
        localStorage.setItem("arch_api_key", qKey);
        history.replaceState({}, "", "/dashboard");
        document.getElementById("load-btn").click();
        return;
      }
      // Try session cookie via /auth/me
      try {
        var meResp = await fetch("/auth/me", { credentials: "include" });
        if (meResp.ok) {
          var me = await meResp.json();
          if (me.ok && me.api_key) {
            document.getElementById("key-input").value = me.api_key;
            localStorage.setItem("arch_api_key", me.api_key);
            document.getElementById("load-btn").click();
            var navLinks = document.querySelector(".at-nav-links");
            if (navLinks) navLinks.innerHTML += '<a href="/auth/logout" style="color:#f87171;font-size:13px;">Sign out</a>';
            return;
          }
        }
      } catch(_) {}
      // Fall back to localStorage
      var saved = localStorage.getItem("arch_api_key");
      if (saved) {
        document.getElementById("key-input").value = saved;
        document.getElementById("load-btn").click();
      } else {
        var sub = document.querySelector(".page-sub");
        if (sub) sub.innerHTML = 'Enter your API key below, or <a href="/login" style="color:var(--accent);">sign in with email & password →</a>';
      }
    })();
  </script>
</body>
</html>`;
//# sourceMappingURL=dashboardHtml.js.map