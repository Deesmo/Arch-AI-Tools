export const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arch Tools — Sign In</title>
  <link rel="apple-touch-icon" href="/apple-touch-icon-v2.png" />
  <link rel="icon" href="/arch-icon.svg?v=2" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #07061A; --border: rgba(255,255,255,0.10);
      --text: rgba(255,255,255,0.92); --muted: rgba(255,255,255,0.55);
      --grad: linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);
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
    /* HAMBURGER */
    .hamburger { display:none; background:none; border:none; cursor:pointer; padding:6px; }
    .hamburger svg { width:24px; height:24px; stroke:var(--text); stroke-width:2; stroke-linecap:round; }
    .mobile-menu { display:none; flex-direction:column; gap:6px; padding:12px 24px 16px; border-bottom:1px solid var(--border); background:rgba(7,6,26,0.95); }
    .mobile-menu a { color:var(--muted); text-decoration:none; font-size:14px; padding:8px 0; }
    .mobile-menu a:hover { color:var(--text); }
    .mobile-menu.open { display:flex; }
    @media (max-width:768px) {
      .nav-links { display:none; }
      .hamburger { display:block; }
    }
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
    .field input:focus { border-color:rgba(34,211,238,0.5); box-shadow:0 0 0 3px rgba(34,211,238,0.08); }
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
    <div style="width:32px;height:32px;border-radius:8px;background:#07061A;border:1px solid rgba(255,255,255,0.12);display:grid;place-items:center;">
      <svg viewBox="0 10 100 90" overflow="visible" width="20" height="20"><defs><linearGradient id="arch-grad-nav" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF9010"/><stop offset="60%" stop-color="#FF2896"/><stop offset="100%" stop-color="#8844FF"/></linearGradient><filter id="arch-neon-nav"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path fill="url(#arch-grad-nav)" filter="url(#arch-neon-nav)" d="M15,100L15,55A35,35,0,0,1,85,55L85,100L74,100L74,55A24,24,0,0,0,26,55L26,100Z M34,100L34,55A16,16,0,0,1,66,55L66,100L58,100L58,55A8,8,0,0,0,42,55L42,100Z"/></svg>
    </div>
    Arch Tools
  </a>
  <div class="nav-links">
    <a href="/">Home</a>
    <a href="/docs">Docs</a>
    <a href="/changelog">Changelog</a>
    <a href="/#pricing">Pricing</a>
    <a href="/signup">Get API Key</a>
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
  <a href="/login">Sign In</a>
</div>

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
      <div style="text-align:right;margin-top:-8px;margin-bottom:12px;font-size:12px;">
        <a href="#" onclick="showForgot();return false;" style="color:rgba(255,255,255,0.4);text-decoration:none;">Forgot password?</a>
      </div>
      <div id="forgot-form" style="display:none;margin-bottom:12px;">
        <input type="email" id="forgot-email" placeholder="your@email.com" style="width:100%;height:42px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#fff;padding:0 14px;font-family:inherit;font-size:13px;outline:none;margin-bottom:8px;" />
        <button onclick="doForgot()" style="width:100%;height:40px;border-radius:10px;border:0;background:rgba(255,144,16,0.15);border:1px solid rgba(255,144,16,0.3);color:#FF9010;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;">Send Reset Link</button>
        <div id="forgot-status" style="font-size:12px;min-height:16px;margin-top:6px;"></div>
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
      <a href="/signup">Create free account</a> — includes 100 free credits (10 instant, 90 on email verify)
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
        var params = new URLSearchParams(window.location.search);
        var next = params.get('next') || '/dashboard';
        setTimeout(() => window.location.href = next, 500);
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

  async function doKeyLogin() {
    var key = document.getElementById('api-key-input').value.trim();
    if (!key.startsWith('arch_')) { setStatus('status-key', 'API keys start with arch_', true); return; }
    setStatus('status-key', '', false);
    try {
      var r = await fetch('/auth/login-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ api_key: key })
      });
      var d = await r.json();
      if (d.ok) {
        sessionStorage.setItem('arch_api_key', key);
        setStatus('status-key', '✓ Key validated — redirecting…', false);
        var params = new URLSearchParams(window.location.search);
        var next = params.get('next') || '/dashboard';
        setTimeout(function() { window.location.href = next; }, 500);
      } else {
        setStatus('status-key', d.message || 'Invalid API key.', true);
      }
    } catch(_) {
      setStatus('status-key', 'Connection error. Try again.', true);
    }
  }

  // Handle Enter key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var tab = document.getElementById('tab-password').classList.contains('active') ? 'password' : 'key';
      if (tab === 'password') doLogin();
      else doKeyLogin();
    }
  });

  function showForgot() {
    var f = document.getElementById('forgot-form');
    f.style.display = f.style.display === 'none' ? 'block' : 'none';
    if (f.style.display === 'block') document.getElementById('forgot-email').focus();
  }

  async function doForgot() {
    var email = (document.getElementById('forgot-email').value || '').trim();
    var st = document.getElementById('forgot-status');
    if (!email) { st.style.color='#f87171'; st.textContent='Enter your email.'; return; }
    st.style.color='rgba(255,255,255,0.5)'; st.textContent='Sending…';
    var r = await fetch('/auth/forgot-password', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email })
    });
    var d = await r.json();
    st.style.color='#34d399';
    st.textContent = d.message || 'Reset link sent if account exists.';
  }

  // If already logged in, redirect
  fetch('/auth/me', { credentials: 'include' }).then(r => r.json()).then(d => {
    if (d.ok) window.location.href = '/dashboard';
  }).catch(() => {});
</script>
  <footer style="border-top:1px solid rgba(255,255,255,0.06);padding:24px 0;text-align:center;font-size:12px;color:rgba(255,255,255,0.35);margin-top:48px;">
    © 2026 MCMetaverse LLC · <a href="/terms.html" style="color:rgba(255,255,255,0.45);text-decoration:none;">Terms</a> · <a href="/privacy.html" style="color:rgba(255,255,255,0.45);text-decoration:none;">Privacy</a> · <a href="/docs" style="color:rgba(255,255,255,0.45);text-decoration:none;">Docs</a>
  </footer>
<!-- Arch Tools Chat Widget --><style>#arch-chat-bubble{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#FFB030,#FF1888 42%,#5522FF);border:none;cursor:pointer;z-index:99999;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(85,34,255,0.4);transition:transform .2s,box-shadow .2s}#arch-chat-bubble:hover{transform:scale(1.1);box-shadow:0 6px 32px rgba(85,34,255,0.6)}#arch-chat-bubble svg{width:28px;height:28px;fill:#fff}#arch-chat-window{position:fixed;bottom:92px;right:24px;width:380px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#0c0b1e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;z-index:99999;display:none;flex-direction:column;overflow:hidden;box-shadow:0 8px 48px rgba(0,0,0,0.6);font-family:'JetBrains Mono',monospace}#arch-chat-window.open{display:flex}#arch-chat-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:linear-gradient(135deg,rgba(85,34,255,0.15),rgba(255,24,136,0.1));border-bottom:1px solid rgba(255,255,255,0.08)}#arch-chat-header .ach-title{font-size:14px;font-weight:600;color:#fff;display:flex;align-items:center;gap:8px}#arch-chat-header .ach-title .ach-dot{width:8px;height:8px;border-radius:50%;background:#34d399;animation:ach-pulse 2s infinite}@keyframes ach-pulse{0%,100%{opacity:1}50%{opacity:.4}}#arch-chat-close{background:none;border:none;color:rgba(255,255,255,0.5);font-size:20px;cursor:pointer;padding:4px 8px;line-height:1}#arch-chat-close:hover{color:#fff}#arch-chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}#arch-chat-messages::-webkit-scrollbar{width:4px}#arch-chat-messages::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:4px}.ach-msg{max-width:85%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}.ach-msg.bot{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.88);border-bottom-left-radius:4px;align-self:flex-start}.ach-msg.user{background:linear-gradient(135deg,#5522FF,#FF1888);color:#fff;border-bottom-right-radius:4px;align-self:flex-end}.ach-typing{display:flex;gap:4px;padding:10px 14px;align-self:flex-start}.ach-typing span{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.3);animation:ach-bounce .6s infinite alternate}.ach-typing span:nth-child(2){animation-delay:.2s}.ach-typing span:nth-child(3){animation-delay:.4s}@keyframes ach-bounce{to{opacity:1;transform:translateY(-4px)}}#arch-chat-input-row{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(7,6,26,0.8)}#arch-chat-input{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:#fff;font-size:13px;font-family:'JetBrains Mono',monospace;outline:none;resize:none}#arch-chat-input::placeholder{color:rgba(255,255,255,0.3)}#arch-chat-input:focus{border-color:rgba(85,34,255,0.5)}#arch-chat-send{background:linear-gradient(135deg,#5522FF,#FF1888);border:none;border-radius:8px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .2s}#arch-chat-send:hover{opacity:.85}#arch-chat-send:disabled{opacity:.4;cursor:not-allowed}#arch-chat-send svg{width:18px;height:18px;fill:#fff}@media(max-width:480px){#arch-chat-window{bottom:0;right:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}}</style><button id="arch-chat-bubble" aria-label="Open chat" onclick="archChatToggle()"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg></button><div id="arch-chat-window"><div id="arch-chat-header"><div class="ach-title"><div class="ach-dot"></div>Arch Tools Support</div><button id="arch-chat-close" onclick="archChatToggle()" aria-label="Close chat">&times;</button></div><div id="arch-chat-messages"><div class="ach-msg bot">Hey! 👋 I'm the Arch Tools assistant. Ask me about our API, pricing, MCP setup, x402 payments, or anything else!</div></div><div id="arch-chat-input-row"><input type="text" id="arch-chat-input" placeholder="Ask about Arch Tools..." maxlength="2000" autocomplete="off" /><button id="arch-chat-send" onclick="archChatSend()" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div></div><script>(function(){var chatHistory=[],sending=false;window.archChatToggle=function(){var w=document.getElementById('arch-chat-window');w.classList.toggle('open');if(w.classList.contains('open'))document.getElementById('arch-chat-input').focus()};function addMsg(text,role){var msgs=document.getElementById('arch-chat-messages'),d=document.createElement('div');d.className='ach-msg '+(role==='user'?'user':'bot');d.textContent=text;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;chatHistory.push({role:role,content:text});if(chatHistory.length>20)chatHistory=chatHistory.slice(-20)}function showTyping(){var msgs=document.getElementById('arch-chat-messages'),t=document.createElement('div');t.className='ach-typing';t.id='ach-typing-ind';t.innerHTML='<span></span><span></span><span></span>';msgs.appendChild(t);msgs.scrollTop=msgs.scrollHeight}function hideTyping(){var t=document.getElementById('ach-typing-ind');if(t)t.remove()}window.archChatSend=function(){if(sending)return;var inp=document.getElementById('arch-chat-input'),msg=inp.value.trim();if(!msg)return;inp.value='';addMsg(msg,'user');sending=true;document.getElementById('arch-chat-send').disabled=true;showTyping();fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,history:chatHistory.slice(0,-1)})}).then(function(r){return r.json()}).then(function(d){hideTyping();if(d.ok&&d.reply)addMsg(d.reply,'assistant');else addMsg('Sorry, something went wrong. Please try again.','assistant')}).catch(function(){hideTyping();addMsg('Connection error. Please try again.','assistant')}).finally(function(){sending=false;document.getElementById('arch-chat-send').disabled=false})};document.addEventListener('keydown',function(e){if(e.key==='Enter'&&document.activeElement===document.getElementById('arch-chat-input')&&!e.shiftKey){e.preventDefault();archChatSend()}})})();</script>
</body>
</html>`;
