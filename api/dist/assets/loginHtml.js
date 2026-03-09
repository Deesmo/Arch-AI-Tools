"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOGIN_HTML = void 0;
exports.LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arch Tools — Sign In</title>
  <link rel="apple-touch-icon" href="/apple-touch-icon-v2.png" />
  <link rel="icon" href="/arch-icon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #07061A; --border: rgba(255,255,255,0.10);
      --text: rgba(255,255,255,0.92); --muted: rgba(255,255,255,0.55);
      --grad: linear-gradient(135deg,#FF9010,#FF2896);
      --green: #34d399; --red: #f87171;
    }
    body {
      font-family: Syne, system-ui, sans-serif;
      background: radial-gradient(900px 500px at 20% 10%, rgba(136,68,255,0.18), transparent 65%),
                  radial-gradient(700px 400px at 80% 80%, rgba(255,40,150,0.12), transparent 65%),
                  var(--bg);
      color: var(--text); min-height: 100vh;
      display: flex; flex-direction: column;
    }
    /* NAV */
    nav { display:flex; align-items:center; justify-content:space-between; padding:0 24px; height:60px; border-bottom:1px solid var(--border); background:rgba(7,6,26,0.88); backdrop-filter:blur(16px); }
    .logo { display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--text); font-weight:700; font-size:16px; }
    .nav-links { display:flex; gap:20px; font-size:13px; }
    .nav-links a { color:var(--muted); text-decoration:none; }
    .nav-links a:hover { color:var(--text); }
    /* PAGE */
    .page { flex:1; display:flex; align-items:center; justify-content:center; padding:40px 16px; }
    .card {
      width:100%; max-width:400px;
      background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1);
      border-radius:20px; padding:36px 32px;
    }
    .card-title { font-size:24px; font-weight:800; letter-spacing:-0.04em; margin-bottom:6px; }
    .card-sub { font-size:14px; color:var(--muted); margin-bottom:28px; }
    /* FORM */
    .field { margin-bottom:16px; }
    .field label { display:block; font-size:12px; font-weight:700; letter-spacing:0.06em; color:var(--muted); text-transform:uppercase; margin-bottom:7px; }
    .field input {
      width:100%; height:46px; border-radius:12px;
      border:1px solid rgba(255,255,255,0.12);
      background:rgba(0,0,0,0.3); color:var(--text);
      padding:0 14px; font-family:inherit; font-size:14px; outline:none;
      transition:border-color 0.15s, box-shadow 0.15s;
    }
    .field input:focus { border-color:rgba(255,144,16,0.5); box-shadow:0 0 0 3px rgba(255,144,16,0.08); }
    .btn-submit {
      width:100%; height:48px; border-radius:12px; border:none;
      background:var(--grad); color:#fff; font-family:inherit;
      font-size:15px; font-weight:700; cursor:pointer;
      margin-top:8px; transition:opacity 0.15s;
    }
    .btn-submit:disabled { opacity:0.5; cursor:not-allowed; }
    /* STATUS */
    .status { min-height:20px; font-size:13px; margin-bottom:12px; }
    .status.error { color:var(--red); }
    .status.success { color:var(--green); }
    /* DIVIDER */
    .divider { display:flex; align-items:center; gap:12px; margin:24px 0; }
    .divider::before, .divider::after { content:''; flex:1; height:1px; background:var(--border); }
    .divider span { font-size:12px; color:var(--muted); white-space:nowrap; }
    /* ALT LINKS */
    .alt-links { text-align:center; font-size:13px; color:var(--muted); }
    .alt-links a { color:#FF9010; text-decoration:none; }
    .alt-links a:hover { text-decoration:underline; }
    /* TABS */
    .tabs { display:flex; gap:4px; background:rgba(0,0,0,0.25); border-radius:10px; padding:4px; margin-bottom:24px; }
    .tab { flex:1; height:36px; border-radius:8px; border:none; background:transparent; color:var(--muted); font-family:inherit; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.15s; }
    .tab.active { background:rgba(255,255,255,0.08); color:var(--text); }
  </style>
</head>
<body>
<nav>
  <a href="/" class="logo">
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#07061A"/>
      <path d="M16 5L27 26H5L16 5Z" fill="none" stroke="url(#lg)" stroke-width="2.2" stroke-linejoin="round"/>
      <defs><linearGradient id="lg" x1="5" y1="5" x2="27" y2="26"><stop stop-color="#FF9010"/><stop offset="1" stop-color="#FF2896"/></linearGradient></defs>
    </svg>
    Arch Tools
  </a>
  <div class="nav-links">
    <a href="/">Home</a>
    <a href="/docs.html">Docs</a>
    <a href="/signup">Register</a>
  </div>
</nav>

<div class="page">
  <div class="card">
    <h1 class="card-title">Sign in</h1>
    <p class="card-sub">Access your dashboard and API key</p>

    <div class="tabs">
      <button class="tab active" id="tab-password" onclick="showTab('password')">Email & Password</button>
      <button class="tab" id="tab-key" onclick="showTab('key')">API Key</button>
    </div>

    <!-- Email + Password form -->
    <div id="form-password">
      <div class="field">
        <label>Email</label>
        <input type="email" id="email" placeholder="you@example.com" autocomplete="email" />
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" id="password" placeholder="••••••••" autocomplete="current-password" />
      </div>
      <div class="status" id="status-password"></div>
      <button class="btn-submit" id="btn-login" onclick="doLogin()">Sign in →</button>
    </div>

    <!-- API Key redirect form -->
    <div id="form-key" style="display:none;">
      <div class="field">
        <label>API Key</label>
        <input type="text" id="api-key-input" placeholder="arch_..." autocomplete="off" />
      </div>
      <div class="status" id="status-key"></div>
      <button class="btn-submit" onclick="doKeyLogin()">Go to Dashboard →</button>
    </div>

    <div class="divider"><span>Don't have an account?</span></div>
    <div class="alt-links">
      <a href="/signup">Create free account</a> — includes 100 free credits
    </div>
  </div>
</div>

<script>
  function showTab(tab) {
    document.getElementById('tab-password').classList.toggle('active', tab === 'password');
    document.getElementById('tab-key').classList.toggle('active', tab === 'key');
    document.getElementById('form-password').style.display = tab === 'password' ? 'block' : 'none';
    document.getElementById('form-key').style.display = tab === 'key' ? 'block' : 'none';
  }

  function setStatus(id, msg, isError) {
    var el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'status ' + (isError ? 'error' : (msg ? 'success' : ''));
  }

  async function doLogin() {
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    if (!email || !password) { setStatus('status-password', 'Email and password are required.', true); return; }
    var btn = document.getElementById('btn-login');
    btn.disabled = true; btn.textContent = 'Signing in…';
    setStatus('status-password', '', false);
    try {
      var r = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      var d = await r.json();
      if (d.ok) {
        setStatus('status-password', '✓ Signed in — redirecting…', false);
        setTimeout(() => window.location.href = '/dashboard', 500);
      } else if (d.error === 'no_password_set') {
        setStatus('status-password', 'No password set for this account. Use the API Key tab to access your dashboard, then set a password from there.', true);
      } else {
        setStatus('status-password', 'Invalid email or password.', true);
        btn.disabled = false; btn.textContent = 'Sign in →';
      }
    } catch(_) {
      setStatus('status-password', 'Connection error. Try again.', true);
      btn.disabled = false; btn.textContent = 'Sign in →';
    }
  }

  function doKeyLogin() {
    var key = document.getElementById('api-key-input').value.trim();
    if (!key.startsWith('arch_')) { setStatus('status-key', 'API keys start with arch_', true); return; }
    localStorage.setItem('arch_api_key', key);
    window.location.href = '/dashboard';
  }

  // Handle Enter key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var tab = document.getElementById('tab-password').classList.contains('active') ? 'password' : 'key';
      if (tab === 'password') doLogin();
      else doKeyLogin();
    }
  });

  // If already logged in, redirect
  fetch('/auth/me', { credentials: 'include' }).then(r => r.json()).then(d => {
    if (d.ok) window.location.href = '/dashboard';
  }).catch(() => {});
</script>
</body>
</html>`;
//# sourceMappingURL=loginHtml.js.map