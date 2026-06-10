// Auto-generated: landing page HTML embedded as string constant
// This avoids filesystem lookups at runtime
export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arch Tools — Production-Ready API Tools for AI Agents & Developers</title>
  <meta name="description" content="64 AI-powered API tools for developers and AI agents. Scrape, generate, convert, detect, and more. One API key. 100 free credits on signup. No credit card required." />
  <meta property="og:title" content="Arch Tools — API Tools for AI Agents" />
  <meta property="og:description" content="Production-ready utility tools for developers and AI agents. Validate, hash, scrape, convert, and generate — all with a single API key." />
  <meta property="og:image" content="https://archtools.dev/og-image.png" />
  <meta property="og:url" content="https://archtools.dev" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #030308;
      --bg2: #080810;
      --card: #0c0c16;
      --border: rgba(255,255,255,0.07);
      --border2: rgba(255,255,255,0.12);
      --text: #f0f0f6;
      --muted: #6b6b80;
      --accent: #00e5b0;
      --accent2: #0066ff;
      --accent3: #aa44ff;
      --warn: #ff9500;
      --grad: linear-gradient(135deg, var(--accent) 0%, var(--accent2) 50%, var(--accent3) 100%);
    }

    html { scroll-behavior: smooth; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Instrument Sans', system-ui, -apple-system, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      overflow-x: hidden;
    }

    /* ── TOPLINE ── */
    .topline {
      height: 2px;
      background: linear-gradient(90deg, transparent 0%, var(--accent) 20%, var(--accent2) 55%, var(--accent3) 80%, transparent 100%);
    }

    /* ── NAV ── */
    nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(3,3,8,0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      padding: 0 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 60px;
    }
    .nav-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
    }
    .logo-mark {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 16px;
      color: #000;
      letter-spacing: -0.5px;
      flex-shrink: 0;
    }
    .logo-name {
      font-family: 'Syne', sans-serif;
      font-weight: 700;
      font-size: 17px;
      color: var(--text);
    }
    .nav-links {
      display: flex;
      align-items: center;
      gap: 24px;
      list-style: none;
    }
    .nav-links a {
      color: var(--muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: color 0.15s;
    }
    .nav-links a:hover { color: var(--text); }
    .nav-cta {
      background: var(--accent);
      color: #000 !important;
      padding: 7px 18px;
      border-radius: 6px;
      font-weight: 600 !important;
      font-size: 13px !important;
      transition: opacity 0.15s !important;
    }
    .nav-cta:hover { opacity: 0.88; }

    .nav-toggle {
      display: none;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.04);
      color: var(--text);
      cursor: pointer;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 0;
    }
    .nav-toggle span {
      display: block;
      width: 18px;
      height: 2px;
      background: rgba(255,255,255,0.85);
      border-radius: 2px;
    }

    /* ── HERO ── */
    .hero {
      position: relative;
      min-height: 88vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 80px 24px 100px;
      overflow: hidden;
    }
    .hero-bg {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .hero-glow {
      position: absolute;
      width: 800px;
      height: 500px;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -55%);
      background: radial-gradient(ellipse at center, rgba(0,229,176,0.08) 0%, rgba(0,102,255,0.05) 40%, transparent 70%);
      filter: blur(40px);
    }
    .hero-grid {
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
      background-size: 60px 60px;
      mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, black 0%, transparent 100%);
    }
    .hero-inner {
      position: relative;
      max-width: 860px;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(0,229,176,0.08);
      border: 1px solid rgba(0,229,176,0.2);
      border-radius: 100px;
      padding: 5px 14px 5px 10px;
      font-size: 12px;
      font-weight: 600;
      color: var(--accent);
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 28px;
      animation: fadeUp 0.6s ease both;
    }
    .hero-badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    h1 {
      font-family: 'Syne', sans-serif;
      font-size: clamp(2.8rem, 6vw, 5rem);
      font-weight: 800;
      line-height: 1.05;
      letter-spacing: -1.5px;
      animation: fadeUp 0.6s 0.1s ease both;
      margin-bottom: 24px;
    }
    h1 .grad {
      background: var(--grad);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero-sub {
      font-size: clamp(1rem, 2vw, 1.2rem);
      color: var(--muted);
      max-width: 620px;
      margin: 0 auto 40px;
      line-height: 1.65;
      animation: fadeUp 0.6s 0.2s ease both;
    }
    .hero-actions {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      flex-wrap: wrap;
      animation: fadeUp 0.6s 0.3s ease both;
    }
    .btn-primary {
      background: var(--accent);
      color: #000;
      padding: 13px 28px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 15px;
      text-decoration: none;
      transition: opacity 0.15s, transform 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
    .btn-ghost {
      background: transparent;
      color: var(--text);
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
      border: 1px solid var(--border2);
      transition: border-color 0.15s, background 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-ghost:hover { border-color: rgba(255,255,255,0.25); background: rgba(255,255,255,0.04); }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── QUICK CODE ── */
    .quickcode {
      margin: 56px auto 0;
      max-width: 700px;
      animation: fadeUp 0.6s 0.4s ease both;
    }
    .quickcode-tabs {
      display: flex;
      gap: 2px;
      margin-bottom: -1px;
    }
    .qtab {
      background: transparent;
      border: 1px solid var(--border);
      border-bottom: none;
      color: var(--muted);
      padding: 7px 16px;
      font-size: 12px;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      cursor: pointer;
      border-radius: 6px 6px 0 0;
      transition: background 0.15s, color 0.15s;
    }
    .qtab.active { background: var(--card); color: var(--accent); border-color: var(--border2); }
    .code-block {
      background: var(--card);
      border: 1px solid var(--border2);
      border-radius: 0 8px 8px 8px;
      padding: 24px;
      text-align: left;
      position: relative;
      overflow: hidden;
    }
    .code-block pre {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.7;
      color: #ccc;
      overflow-x: auto;
      white-space: pre;
    }
    .code-tab { display: none; }
    .code-tab.active { display: block; }
    .c-green { color: #00e5b0; }
    .c-blue { color: #66aaff; }
    .c-purple { color: #cc88ff; }
    .c-gray { color: #666680; }
    .c-str { color: #ffcc77; }
    .c-num { color: #ff9966; }
    .copy-btn {
      position: absolute;
      top: 14px;
      right: 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 5px 10px;
      border-radius: 5px;
      font-size: 11px;
      font-family: 'JetBrains Mono', monospace;
      cursor: pointer;
      transition: all 0.15s;
    }
    .copy-btn:hover { background: rgba(255,255,255,0.1); color: var(--text); }

    /* ── SECTION WRAPPER ── */
    .section {
      padding: 80px 24px;
      max-width: 1100px;
      margin: 0 auto;
    }
    .section-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 14px;
    }
    .section-title {
      font-family: 'Syne', sans-serif;
      font-size: clamp(1.8rem, 3.5vw, 2.8rem);
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 12px;
      line-height: 1.1;
    }
    .section-sub {
      color: var(--muted);
      font-size: 1rem;
      max-width: 560px;
      line-height: 1.65;
      margin-bottom: 52px;
    }
    .divider {
      height: 1px;
      background: var(--border);
      margin: 0 24px;
    }

    /* ── TOOLS GRID ── */
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
    }
    .tool-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 22px 24px;
      transition: border-color 0.2s, transform 0.2s, background 0.2s;
      cursor: default;
      position: relative;
      overflow: hidden;
    }
    .tool-card::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 12px;
      background: var(--grad);
      opacity: 0;
      transition: opacity 0.2s;
    }
    .tool-card:hover {
      border-color: rgba(0,229,176,0.25);
      transform: translateY(-2px);
    }
    .tool-card:hover::before { opacity: 0.04; }
    .tool-card-inner { position: relative; }
    .tool-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .tool-icon {
      width: 38px;
      height: 38px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }
    .tool-price {
      background: rgba(0,229,176,0.08);
      border: 1px solid rgba(0,229,176,0.15);
      color: var(--accent);
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 5px;
    }
    .tool-name {
      font-family: 'Syne', sans-serif;
      font-weight: 700;
      font-size: 15px;
      margin-bottom: 6px;
      letter-spacing: -0.2px;
    }
    .tool-desc {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .tool-endpoint {
      margin-top: 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: rgba(0,229,176,0.6);
      background: rgba(0,229,176,0.04);
      padding: 5px 8px;
      border-radius: 4px;
      display: inline-block;
    }

    /* ── CATEGORY TAGS ── */
    .cat-data { background: rgba(0,102,255,0.12); }
    .cat-security { background: rgba(170,68,255,0.12); }
    .cat-media { background: rgba(255,149,0,0.12); }
    .cat-text { background: rgba(0,229,176,0.12); }
    .cat-web { background: rgba(255,77,77,0.12); }
    .cat-files { background: rgba(255,149,0,0.12); }
    .cat-ai { background: rgba(0,229,176,0.15); }

    /* ── HOW IT WORKS ── */
    .steps {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 24px;
    }
    .step {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .step-num {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(0,229,176,0.08);
      border: 1px solid rgba(0,229,176,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 16px;
      color: var(--accent);
    }
    .step-title {
      font-family: 'Syne', sans-serif;
      font-weight: 700;
      font-size: 16px;
      margin-bottom: 4px;
    }
    .step-desc {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }

    /* ── DUAL PAYMENT ── */
    .payment-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 640px) { .payment-grid { grid-template-columns: 1fr; } }
    .payment-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 28px;
    }
    .payment-tag {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 4px;
      margin-bottom: 14px;
    }
    .tag-stripe { background: rgba(99,91,255,0.15); color: #8888ff; }
    .tag-crypto { background: rgba(0,229,176,0.1); color: var(--accent); }
    .payment-title {
      font-family: 'Syne', sans-serif;
      font-size: 20px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .payment-desc {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 20px;
    }
    .payment-detail {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .payment-detail::before { content: '→'; color: var(--accent); font-weight: 700; }

    /* ── PRICING ── */
    #pricing { scroll-margin-top: 80px; }
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    @media (max-width: 768px) { .pricing-grid { grid-template-columns: 1fr; } }
    .plan-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 28px;
      display: flex;
      flex-direction: column;
      position: relative;
      transition: border-color 0.2s;
    }
    .plan-card.featured {
      border-color: rgba(0,229,176,0.35);
      background: linear-gradient(135deg, rgba(0,229,176,0.04) 0%, var(--card) 60%);
    }
    .plan-featured-badge {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--accent);
      color: #000;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 3px 12px;
      border-radius: 20px;
      white-space: nowrap;
    }
    .plan-name {
      font-family: 'Syne', sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 16px;
    }
    .plan-price {
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 42px;
      letter-spacing: -1.5px;
      line-height: 1;
      margin-bottom: 4px;
    }
    .plan-price sup { font-size: 20px; font-weight: 700; vertical-align: super; letter-spacing: 0; }
    .plan-freq {
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 24px;
    }
    .plan-credits {
      background: rgba(0,229,176,0.06);
      border: 1px solid rgba(0,229,176,0.12);
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 24px;
    }
    .plan-credits-num {
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 22px;
      color: var(--accent);
      letter-spacing: -0.5px;
    }
    .plan-credits-label {
      font-size: 12px;
      color: var(--muted);
      margin-top: 2px;
    }
    .plan-features {
      list-style: none;
      flex: 1;
      margin-bottom: 24px;
    }
    .plan-features li {
      font-size: 14px;
      color: var(--muted);
      padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .plan-features li::before { content: '✓'; color: var(--accent); font-weight: 700; }
    .plan-btn {
      display: block;
      text-align: center;
      padding: 12px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      text-decoration: none;
      transition: all 0.15s;
    }
    .plan-btn-primary {
      background: var(--accent);
      color: #000;
    }
    .plan-btn-primary:hover { opacity: 0.88; }
    .plan-btn-ghost {
      background: transparent;
      border: 1px solid var(--border2);
      color: var(--text);
    }
    .plan-btn-ghost:hover { background: rgba(255,255,255,0.05); }

    /* ── MCP SECTION ── */
    .mcp-block {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 40px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      align-items: center;
    }
    @media (max-width: 768px) { .mcp-block { grid-template-columns: 1fr; } }
    .mcp-title {
      font-family: 'Syne', sans-serif;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 14px;
    }
    .mcp-desc {
      color: var(--muted);
      font-size: 15px;
      line-height: 1.65;
      margin-bottom: 22px;
    }
    .mcp-links {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .mcp-link {
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      text-decoration: none;
      transition: all 0.15s;
    }
    .mcp-link:hover { border-color: rgba(0,229,176,0.3); color: var(--accent); }
    .mcp-code-side .code-block { border-radius: 12px; }

    /* ── STATS ── */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
      background: var(--border);
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow: hidden;
      margin-bottom: 80px;
    }
    @media (max-width: 640px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
    .stat {
      background: var(--bg2);
      padding: 28px;
      text-align: center;
    }
    .stat-num {
      font-family: 'Syne', sans-serif;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: -1px;
      background: var(--grad);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .stat-label {
      font-size: 13px;
      color: var(--muted);
      margin-top: 4px;
    }

    /* ── FOOTER ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 40px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      max-width: 1100px;
      margin: 0 auto;
    }
    .footer-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .footer-links {
      display: flex;
      gap: 24px;
    }
    .footer-links a {
      color: var(--muted);
      text-decoration: none;
      font-size: 13px;
      transition: color 0.15s;
    }
    .footer-links a:hover { color: var(--text); }

    /* ── RESPONSIVE ── */
    @media (max-width: 768px) {
      nav { padding: 0 16px; }
      .nav-toggle { display: inline-flex; }
      .nav-links {
        display: none;
        position: absolute;
        top: 68px;
        right: 16px;
        left: 16px;
        flex-direction: column;
        align-items: stretch;
        gap: 0;
        padding: 10px;
        background: rgba(10, 12, 18, 0.92);
        border: 1px solid var(--border);
        border-radius: 14px;
        backdrop-filter: blur(10px);
      }
      .nav-links.open { display: flex; }
      .nav-links li a {
        display: block;
        padding: 12px 12px;
      }
      .nav-links li a.nav-cta { text-align: center; margin-top: 6px; }
      .section { padding: 60px 16px; }
      .tools-grid { grid-template-columns: 1fr; }
      .pricing-grid { grid-template-columns: 1fr; }
      footer { flex-direction: column; }
    }

    @media (max-width: 420px) {
      .code-block { padding: 14px; }
      .qtab { padding: 7px 10px; }
    }
  </style>
</head>
<body>

<div class="topline"></div>

<nav>
  <a class="nav-logo" href="/">
    <div class="logo-mark">A</div>
    <span class="logo-name">Arch Tools</span>
  </a>
  <button class="nav-toggle" aria-label="Open menu" id="nav-toggle-btn">
    <span></span><span></span><span></span>
  </button>
  <ul class="nav-links">
    <li><a href="#tools">Tools</a></li>
    <li><a href="#pricing">Pricing</a></li>
    <li><a href="/docs">API Docs</a></li>
    <li><a href="/#mcp">MCP</a></li>
    <li><a href="/signup" class="nav-cta">Get API Key →</a></li>
  </ul>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="hero-bg">
    <div class="hero-glow"></div>
    <div class="hero-grid"></div>
  </div>
  <div class="hero-inner">
    <div class="hero-badge">
      <div class="hero-badge-dot"></div>
      Now live · 64 production tools · 100 free credits on signup · No credit card required
    </div>
    <h1>64 Tools Your AI Agent<br><span class="grad">Can Call Right Now</span></h1>
    <p class="hero-sub">
      One API key. 64 ready-to-use tools — scrape websites, generate text with Claude or GPT-4,
      detect PII, convert files, look up crypto prices, extract PDFs, and more.
      Agents pay autonomously in USDC. Developers pay with Stripe. No subscriptions.
    </p>
    <div class="hero-actions">
      <a href="/signup" class="btn-primary">Get Started Free →</a>
      <a href="/docs" class="btn-ghost">View API Docs</a>
      <a href="/openapi.json" class="btn-ghost">OpenAPI Spec</a>
    </div>

    <div class="quickcode">
      <div class="quickcode-tabs">
        <button class="qtab active" data-tab="curl">cURL</button>
        <button class="qtab" data-tab="node">Node.js</button>
        <button class="qtab" data-tab="python">Python</button>
      </div>
      <div class="code-block">
        <button class="copy-btn" id="copy-btn">copy</button>
        <div id="tab-curl" class="code-tab active">
<pre><span class="c-gray"># 1. Register — instant API key (verify email to activate credits)</span>
<span class="c-gray"># Open:</span> <span class="c-str">https://archtools.dev/signup</span>

<span class="c-gray"># 2. Call any tool with your key</span>
curl -X POST <span class="c-str">https://archtools.dev/v1/tools/generate-hash</span> \\
  -H <span class="c-str">'Authorization: Bearer arch_your_key_here'</span> \\
  -H <span class="c-str">'Content-Type: application/json'</span> \\
  -d <span class="c-str">'{"algorithm":"sha256","input":"hello world"}'</span></pre>
        </div>
        <div id="tab-node" class="code-tab">
<pre><span class="c-blue">import</span> { ArchTools } <span class="c-blue">from</span> <span class="c-str">'arch-tools-sdk'</span>;

<span class="c-blue">const</span> client = <span class="c-blue">new</span> <span class="c-green">ArchTools</span>({
  apiKey: <span class="c-str">'arch_your_key_here'</span>
});

<span class="c-gray">// Invoke any tool</span>
<span class="c-blue">const</span> result = <span class="c-blue">await</span> client.tools.<span class="c-green">invoke</span>(<span class="c-str">'generate-hash'</span>, {
  algorithm: <span class="c-str">'sha256'</span>,
  input: <span class="c-str">'hello world'</span>
});
console.<span class="c-green">log</span>(result.result.hash);</pre>
        </div>
        <div id="tab-python" class="code-tab">
<pre><span class="c-blue">from</span> archtools <span class="c-blue">import</span> ArchTools

client = <span class="c-green">ArchTools</span>(api_key=<span class="c-str">"arch_your_key_here"</span>)

<span class="c-gray"># Invoke any tool</span>
result = client.tools.invoke(
    <span class="c-str">"generate-hash"</span>,
    {<span class="c-str">"algorithm"</span>: <span class="c-str">"sha256"</span>, <span class="c-str">"input"</span>: <span class="c-str">"hello world"</span>}
)
<span class="c-blue">print</span>(result[<span class="c-str">"result"</span>][<span class="c-str">"hash"</span>])</pre>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- WHAT IS ARCH TOOLS -->
<div class="divider"></div>
<section class="section">
  <div class="section-label">What is Arch Tools?</div>
  <h2 class="section-title">Think of it as a Swiss Army knife for AI agents</h2>
  <p class="section-sub" style="max-width:680px">
    When you build an AI agent — in Claude, ChatGPT, Cursor, or your own code — it often needs to <em>do things</em>:
    scrape a website, read a PDF, detect bad data, generate text, hash a value, look up a crypto price.
    Instead of building each of those yourself, you give your agent one Arch Tools API key and it can call any of 64 tools instantly.
    One key. 64 tools. Works with REST, MCP, or SDK.
  </p>
  <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:24px">
    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 20px;flex:1;min-width:200px">
      <div style="font-size:22px;margin-bottom:6px">🤖</div>
      <div style="font-weight:700;margin-bottom:4px">For AI Agents</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.6)">Give your Claude, GPT, or custom agent an Arch Tools key. It calls tools autonomously — and pays in USDC via x402, no human approval needed.</div>
    </div>
    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 20px;flex:1;min-width:200px">
      <div style="font-size:22px;margin-bottom:6px">👨‍💻</div>
      <div style="font-weight:700;margin-bottom:4px">For Developers</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.6)">Stop reinventing utilities. Need to scrape, hash, convert, or detect PII? One API call. Charged per use. No monthly fees, no cold starts.</div>
    </div>
    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 20px;flex:1;min-width:200px">
      <div style="font-size:22px;margin-bottom:6px">🔌</div>
      <div style="font-weight:700;margin-bottom:4px">For MCP Clients</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.6)">Claude Desktop, Cursor, Windsurf — connect once via MCP and all 64 tools appear in your toolbox automatically. No extra setup.</div>
    </div>
  </div>
</section>

<!-- STATS -->
<div class="section" style="padding-top:0">
  <div class="stats-row">
    <div class="stat">
      <div class="stat-num">45</div>
      <div class="stat-label">Production Tools</div>
    </div>
    <div class="stat">
      <div class="stat-num">2</div>
      <div class="stat-label">Payment Rails</div>
    </div>
    <div class="stat">
      <div class="stat-num">3</div>
      <div class="stat-label">Plan Tiers</div>
    </div>
    <div class="stat">
      <div class="stat-num">100</div>
      <div class="stat-label">Free Credits / Month</div>
    </div>
  </div>
</div>

<!-- TOOLS -->
<div class="divider"></div>
<section class="section" id="tools">
  <div class="section-label">Tools</div>
  <h2 class="section-title">45 Tools. One API Key.</h2>
  <p class="section-sub">Every tool is schema-validated, rate-limited by plan, and credit-accounted. Powered by Claude, GPT-4, Grok, and Gemini — under one unified API. Discover them all via <code style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--accent)">GET /v1/tools</code>.</p>

  <div class="tools-grid">
    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-data">🔍</div>
          <span class="tool-price">1 credit</span>
        </div>
        <div class="tool-name">Validate Data</div>
        <div class="tool-desc">Validate JSON payloads against any JSON Schema. Returns detailed error paths.</div>
        <div class="tool-endpoint">POST /v1/tools/validate-data</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-security">🔐</div>
          <span class="tool-price">1 credit</span>
        </div>
        <div class="tool-name">Generate Hash</div>
        <div class="tool-desc">Cryptographic hashing — SHA-256, SHA-512, MD5, SHA-1. Deterministic and fast.</div>
        <div class="tool-endpoint">POST /v1/tools/generate-hash</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-media">📷</div>
          <span class="tool-price">2 credits</span>
        </div>
        <div class="tool-name">QR Code</div>
        <div class="tool-desc">Generate QR codes from any text or URL. Returns PNG data URL or SVG. Configurable size.</div>
        <div class="tool-endpoint">POST /v1/tools/qr-code</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-data">⇄</div>
          <span class="tool-price">2 credits</span>
        </div>
        <div class="tool-name">Convert Format</div>
        <div class="tool-desc">Convert between JSON, YAML, and CSV. Bidirectional. Handles nested objects.</div>
        <div class="tool-endpoint">POST /v1/tools/convert-format</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-text">✦</div>
          <span class="tool-price">3 credits</span>
        </div>
        <div class="tool-name">Transform Text</div>
        <div class="tool-desc">10 transformation modes: uppercase, slug, camelCase, snake_case, base64, reverse, and more.</div>
        <div class="tool-endpoint">POST /v1/tools/transform-text</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-data">📊</div>
          <span class="tool-price">3 credits</span>
        </div>
        <div class="tool-name">Extract Metadata</div>
        <div class="tool-desc">Extract word count, OG tags, title, description, canonical URL from text or any URL.</div>
        <div class="tool-endpoint">POST /v1/tools/extract-metadata</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-web">🌐</div>
          <span class="tool-price">5 credits</span>
        </div>
        <div class="tool-name">Web Scrape</div>
        <div class="tool-desc">Scrape and extract clean content from any public URL. Optional CSS selector targeting. SSRF-protected.</div>
        <div class="tool-endpoint">POST /v1/tools/web-scrape</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-web">🔎</div>
          <span class="tool-price">5 credits</span>
        </div>
        <div class="tool-name">Search Web</div>
        <div class="tool-desc">Structured web search for agents — Tavily/Serper when configured, with a safe fallback for quick demos.</div>
        <div class="tool-endpoint">POST /v1/tools/search-web</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-web">📄</div>
          <span class="tool-price">5 credits</span>
        </div>
        <div class="tool-name">Extract Page</div>
        <div class="tool-desc">Fetch a URL and return clean text, metadata, and outbound links — optimized for LLM pipelines.</div>
        <div class="tool-endpoint">POST /v1/tools/extract-page</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-files">📎</div>
          <span class="tool-price">6 credits</span>
        </div>
        <div class="tool-name">Extract PDF</div>
        <div class="tool-desc">Extract PDF text and tables via an optional configured extractor service (enterprise-friendly).</div>
        <div class="tool-endpoint">POST /v1/tools/extract-pdf</div>
      </div>
    </div>

    <div class="tool-card">
      <div class="tool-card-inner">
        <div class="tool-header">
          <div class="tool-icon cat-ai">✦</div>
          <span class="tool-price">20 credits</span>
        </div>
        <div class="tool-name">AI Generate</div>
        <div class="tool-desc">Text generation via Claude. Supports system prompt, model selection, and token limits.</div>
        <div class="tool-endpoint">POST /v1/tools/ai-generate</div>
      </div>
    </div>
  </div>
</section>

<!-- HOW IT WORKS -->
<div class="divider"></div>
<section class="section" id="get-started">
  <div class="section-label">Get Started</div>
  <h2 class="section-title">Up and running in 60 seconds</h2>
  <p class="section-sub">Enter your email, get an API key instantly, and make your first call in under a minute. Verify your email to activate credits. No credit card required.</p>
  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div>
        <div class="step-title">Register</div>
        <div class="step-desc">Enter your email at <a href="/signup" style="color:var(--text);text-decoration:underline">/signup</a> — your API key is generated instantly. 100 free credits added to your account, refreshed monthly.</div>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div>
        <div class="step-title">Discover</div>
        <div class="step-desc">Call <code style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent)">GET /v1/tools</code> to list all available tools with schemas, pricing, and endpoints.</div>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div>
        <div class="step-title">Invoke</div>
        <div class="step-desc">POST to <code style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent)">/v1/tools/:toolName</code> with your bearer token. Credits are debited only on success.</div>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div>
        <div class="step-title">Scale</div>
        <div class="step-desc">Buy credit packs via Stripe checkout or top up with USDC. Upgrade your plan for higher rate limits.</div>
      </div>
    </div>
  </div>
</section>

<!-- DUAL PAYMENT -->
<div class="divider"></div>
<section class="section">
  <div class="section-label">Payment</div>
  <h2 class="section-title">Dual payment rails</h2>
  <p class="section-sub">Built for both developers and autonomous AI agents. Pay how you work.</p>
  <div class="payment-grid">
    <div class="payment-card">
      <span class="payment-tag tag-stripe">Stripe</span>
      <div class="payment-title">For Developers</div>
      <div class="payment-desc">Standard Stripe checkout. Buy credit packs with any card. Instant grant, permanent balance.</div>
      <div class="payment-detail">Starter: 1,000 credits — $9</div>
      <div class="payment-detail">Pro: 10,000 credits — $49</div>
      <div class="payment-detail">Business: 123,000 credits — $199</div>
    </div>
    <div class="payment-card">
      <span class="payment-tag tag-crypto">x402 / USDC</span>
      <div class="payment-title">For AI Agents</div>
      <div class="payment-desc">x402 protocol support on Base and Solana. AI agents pay per-call autonomously with USDC — no human required.</div>
      <div class="payment-detail">Pay-per-call via x402 HTTP protocol</div>
      <div class="payment-detail">Base + Solana networks</div>
      <div class="payment-detail">Auto-discovered via /.well-known/x402</div>
    </div>
  </div>
</section>

<!-- MCP -->
<div class="divider"></div>
<section class="section" id="mcp">
  <div class="section-label">MCP</div>
  <div class="mcp-block">
    <div class="mcp-text">
      <h2 class="mcp-title">Model Context Protocol Native</h2>
      <p class="mcp-desc">
        All 64 tools are auto-exposed via MCP. Connect Claude Desktop, any MCP-compatible agent platform, or deploy the SSE server yourself on Render.
        Tools are dynamically discovered — no config needed.
      </p>
      <div class="mcp-links">
        <a href="/.well-known/x402" class="mcp-link">x402 Discovery</a>
        <a href="/v1/tools" class="mcp-link">Tool Registry</a>
        <a href="/openapi.json" class="mcp-link">OpenAPI Spec</a>
        <a href="/docs/postman" class="mcp-link">Postman Collection</a>
      </div>
    </div>
    <div class="mcp-code-side">
      <div class="code-block">
<pre><span class="c-gray"># Claude Desktop (stdio)</span>
{
  <span class="c-str">"arch-tools"</span>: {
    <span class="c-str">"command"</span>: <span class="c-str">"npx"</span>,
    <span class="c-str">"args"</span>: [<span class="c-str">"arch-tools-mcp"</span>],
    <span class="c-str">"env"</span>: {
      <span class="c-str">"ARCH_API_BASE_URL"</span>: <span class="c-str">"https://archtools.dev"</span>,
      <span class="c-str">"ARCH_API_KEY"</span>: <span class="c-str">"arch_your_key"</span>
    }
  }
}

<span class="c-gray"># Or use hosted SSE endpoint</span>
<span class="c-green">ARCH_API_BASE_URL</span>=https://archtools.dev
<span class="c-green">MCP_TRANSPORT</span>=sse</pre>
      </div>
    </div>
  </div>
</section>

<!-- PRICING -->
<div class="divider"></div>
<section class="section" id="pricing">
  <div class="section-label">Pricing</div>
  <h2 class="section-title">100 Free Credits on Signup. No Credit Card.</h2>
  <p class="section-sub">Every account gets 100 free credits on signup — no card required, no trial expiry.
  Need more? Buy a one-time credit pack. Credits never expire. No subscription ever.</p>
  <div class="pricing-grid">
    <div class="plan-card">
      <div class="plan-name">Starter</div>
      <div class="plan-price"><sup>$</sup>9</div>
      <div class="plan-freq">one-time · no subscription</div>
      <div class="plan-credits">
        <div class="plan-credits-num">1,000</div>
        <div class="plan-credits-label">credits · ~1,000 hash calls or 50 scrapes</div>
      </div>
      <ul class="plan-features">
        <li>All 64 tools</li>
        <li>60 req/min rate limit</li>
        <li>REST + MCP access</li>
        <li>100 free credits on signup</li>
      </ul>
      <button class="plan-btn plan-btn-ghost" data-pack="starter">Buy Starter Credits</button>
    </div>

    <div class="plan-card featured">
      <div class="plan-featured-badge">Most Popular</div>
      <div class="plan-name">Pro</div>
      <div class="plan-price"><sup>$</sup>49</div>
      <div class="plan-freq">one-time · no subscription</div>
      <div class="plan-credits">
        <div class="plan-credits-num">10,000</div>
        <div class="plan-credits-label">credits · ~10,000 hashes or 500 scrapes</div>
      </div>
      <ul class="plan-features">
        <li>All 64 tools</li>
        <li>240 req/min rate limit</li>
        <li>REST + MCP + SDK access</li>
        <li>API key restrictions</li>
        <li>100 free credits on signup</li>
      </ul>
      <button class="plan-btn plan-btn-primary" data-pack="pro">Buy Pro Credits →</button>
    </div>

    <div class="plan-card">
      <div class="plan-name">Business</div>
      <div class="plan-price"><sup>$</sup>199</div>
      <div class="plan-freq">one-time · no subscription</div>
      <div class="plan-credits">
        <div class="plan-credits-num">100,000</div>
        <div class="plan-credits-label">credits · ~100k hashes or 5,000 scrapes</div>
      </div>
      <ul class="plan-features">
        <li>All 64 tools</li>
        <li>1,200 req/min rate limit</li>
        <li>REST + MCP + SDK access</li>
        <li>IP + origin restrictions</li>
        <li>Daily credit caps per key</li>
        <li>100 free credits on signup</li>
      </ul>
      <button class="plan-btn plan-btn-ghost" data-pack="business">Buy Business Credits</button>
    </div>
  </div>
</section>

<!-- FOOTER -->
<div class="divider" style="margin: 0 0"></div>
<footer>
  <div class="footer-brand">
    <div class="logo-mark" style="width:28px;height:28px;font-size:13px;border-radius:6px">A</div>
    <span style="font-family:'Syne',sans-serif;font-weight:700;font-size:15px;color:var(--muted)">Arch Tools</span>
  </div>
  <div class="footer-links">
    <a href="/docs">API Docs</a>
    <a href="/v1/tools">Tool Registry</a>
    <a href="/openapi.json">OpenAPI</a>
    <a href="/legal/terms">Terms</a>
    <a href="/legal/privacy">Privacy</a>
    <a href="/legal/security">Security</a>
    <a href="/changelog">Changelog</a>
  </div>
  <div style="font-size:12px;color:var(--muted)">© 2025 Arch Enterprises LLC</div>
</footer>

<script>
  function toggleNav() {
    const el = document.querySelector('.nav-links');
    if (!el) return;
    el.classList.toggle('open');
  }

  // Wire up nav toggle
  const navToggleBtn = document.getElementById('nav-toggle-btn');
  if (navToggleBtn) navToggleBtn.addEventListener('click', toggleNav);

  // Close mobile menu when clicking a link
  document.addEventListener('click', (e) => {
    const links = document.querySelector('.nav-links');
    if (!links) return;
    const target = e.target;
    if (target && target.closest && target.closest('.nav-links a')) {
      links.classList.remove('open');
    }
  });

  function showTab(name, clickedEl) {
    document.querySelectorAll('.code-tab').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.qtab').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    if (clickedEl) clickedEl.classList.add('active');
  }

  // Wire up code tabs via event delegation
  document.querySelectorAll('.qtab').forEach(function(btn) {
    btn.addEventListener('click', function() { showTab(this.dataset.tab, this); });
  });

  function copyCode() {
    const active = document.querySelector('.code-tab.active pre');
    if (!active) return;
    navigator.clipboard.writeText(active.innerText).then(() => {
      const btn = document.getElementById('copy-btn');
      if (btn) { btn.textContent = 'copied!'; setTimeout(() => btn.textContent = 'copy', 2000); }
    });
  }

  // Wire up copy button
  const copyBtn = document.getElementById('copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', copyCode);

  // Stripe checkout for pricing buttons
  async function buyPack(packName) {
    let apiKey = localStorage.getItem('arch_api_key') || '';
    if (!apiKey) {
      apiKey = window.prompt('Enter your Arch Tools API key (or go to archtools.dev/signup to get one):');
    }
    if (!apiKey || !apiKey.trim()) {
      window.location.href = '/signup';
      return;
    }
    try {
      const res = await fetch('/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey.trim() },
        body: JSON.stringify({ pack: packName })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Error: ' + (data.message || 'Could not create checkout session. Check your API key.'));
      }
    } catch(e) {
      alert('Something went wrong. Please try again.');
    }
  }

  // Wire up pricing buttons via data-pack attributes
  document.querySelectorAll('[data-pack]').forEach(function(btn) {
    btn.addEventListener('click', function() { buyPack(this.dataset.pack); });
  });

  // Animate sections on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.tool-card, .step, .payment-card, .plan-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
</script>
</body>
</html>
`;
//# sourceMappingURL=landingHtml.js.map