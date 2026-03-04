import { Router } from "express";
import { ERROR_REGISTRY } from "../assets/errors.js";

export const docsRouter = Router();

/**
 * GET /docs
 * Branded API docs powered by Swagger UI (loaded from CDN) and our OpenAPI spec at /openapi.json.
 * We intentionally theme this to match Arch Tools' dark, premium developer aesthetic.
 */
docsRouter.get("/docs", (_req, res) => {
  const title = "Arch Tools — API Docs";
  // NOTE: We load Swagger UI assets from a CDN to keep the API service lightweight.
  // If you prefer fully self-hosted assets later, we can vendor swagger-ui-dist.
  const swaggerVersion = "5.17.14";
  const ERRORS_JSON = JSON.stringify(ERROR_REGISTRY);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>

  <!-- Fonts to match archtools.dev -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${swaggerVersion}/swagger-ui.css" />
  <style>
    :root{
      --bg:#06060b;
      --card:#0f0f17;
      --card2:#111119;
      --border:#1a1a28;
      --text:#eeeef2;
      --muted:#888899;
      --accent:#00d4aa;
      --blue:#4488ff;
      --purple:#8855ff;
    }

    html, body { height:100%; background: var(--bg); }
    body { margin:0; color:var(--text); font-family: "DM Sans", system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }

    .topline{
      height:3px;
      background: linear-gradient(90deg, rgba(0,0,0,0) 0%, var(--accent) 20%, var(--blue) 55%, var(--purple) 80%, rgba(0,0,0,0) 100%);
    }

    header{
      padding: 28px 18px 18px 18px;
      max-width: 1180px;
      margin: 0 auto;
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap: 18px;
    }

    .brand{
      display:flex;
      gap: 14px;
      align-items:flex-start;
    }

    .mark{
      width: 46px;
      height: 46px;
      border-radius: 12px;
      background: var(--accent);
      display:flex;
      align-items:center;
      justify-content:center;
      color: var(--bg);
      font-family:"Space Grotesk", system-ui;
      font-weight: 800;
      font-size: 22px;
      box-shadow: 0 10px 30px rgba(0,212,170,0.12);
      flex: 0 0 auto;
    }

    h1{
      margin:0;
      font-family:"Space Grotesk", system-ui;
      font-weight: 700;
      font-size: 22px;
      letter-spacing: 0.2px;
    }
    .subtitle{
      margin-top:6px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.35;
      max-width: 720px;
    }

    .quickstart{
      margin-top: 10px;
      display:flex;
      flex-wrap:wrap;
      gap: 8px;
      color: var(--muted);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono";
      font-size: 12px;
    }
    .pill{
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.02);
      padding: 6px 10px;
      border-radius: 999px;
    }

    .links{
      display:flex;
      gap: 10px;
      flex-wrap:wrap;
      justify-content:flex-end;
    }
    a.btn{
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.02);
      color: var(--text);
      text-decoration:none;
      padding: 10px 12px;
      border-radius: 12px;
      font-size: 13px;
      transition: transform .08s ease, border-color .15s ease;
      white-space: nowrap;
    }
    a.btn:hover { transform: translateY(-1px); border-color: rgba(0,212,170,0.35); }

    /* Swagger UI theming */
    .swagger-ui { max-width: 1180px; margin: 0 auto; padding: 0 18px 26px 18px; }
    .swagger-ui .topbar { display:none; }
    .swagger-ui .info { margin: 18px 0 0 0; }
    .swagger-ui .info .title { color: var(--text); font-family:"Space Grotesk"; }
    .swagger-ui, .swagger-ui .opblock-tag, .swagger-ui .opblock .opblock-summary-description { color: var(--text); }

    .swagger-ui .opblock { background: rgba(255,255,255,0.02); border: 1px solid var(--border); box-shadow:none; }
    .swagger-ui .opblock .opblock-summary { border-bottom: 1px solid var(--border); }
    .swagger-ui .opblock-tag { border-bottom: 1px solid var(--border); }

    .swagger-ui .opblock.opblock-post { border-left: 4px solid var(--accent); }
    .swagger-ui .opblock.opblock-get { border-left: 4px solid var(--blue); }

    .swagger-ui .btn.execute { background: var(--accent) !important; color: var(--bg) !important; border: none !important; }
    .swagger-ui .btn.authorize { border-color: rgba(0,212,170,0.45) !important; color: var(--text) !important; }

    .swagger-ui .parameters-col_description input[type=text],
    .swagger-ui textarea,
    .swagger-ui select { background: rgba(255,255,255,0.03); color: var(--text); border: 1px solid var(--border); }

    .swagger-ui .scheme-container { background: transparent; box-shadow:none; border: 1px solid var(--border); }

    .swagger-ui .model-box, .swagger-ui section.models { background: rgba(255,255,255,0.02); border: 1px solid var(--border); }

    /* Remove some clutter */
    .swagger-ui .info .description { color: var(--muted); }
  
    /* Premium hero */
    header { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(10px); background: rgba(6,6,11,0.72); }
    .hero { max-width: 1180px; margin: 0 auto; padding: 26px 20px 10px; display: grid; grid-template-columns: 1.2fr 1fr; gap: 18px; }
    @media (max-width: 980px){ .hero { grid-template-columns: 1fr; } header{position:relative;} }
    .kicker { color: var(--accent); font-family: "JetBrains Mono", monospace; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 10px; }
    .hero h2 { margin: 0 0 8px; font-family: "Space Grotesk", system-ui; font-size: 28px; line-height: 1.15; }
    .hero-sub { margin: 0 0 16px; color: var(--muted); max-width: 62ch; }
    .steps { display: grid; gap: 12px; }
    .step { background: linear-gradient(180deg, rgba(17,17,25,0.85), rgba(15,15,23,0.85)); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
    .step-title { font-weight: 700; font-family: "Space Grotesk", system-ui; margin-bottom: 8px; }
    .codewrap { position: relative; }
    .copy { position: absolute; top: 10px; right: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--text); padding: 6px 10px; border-radius: 10px; font-family: "DM Sans", system-ui; font-size: 12px; cursor: pointer; }
    .copy:hover { background: rgba(255,255,255,0.08); }
    pre { margin: 0; overflow: auto; border-radius: 12px; border: 1px solid rgba(26,26,40,0.8); background: rgba(6,6,11,0.6); padding: 12px; }
    pre code { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--text); }
    .divider { max-width: 1180px; margin: 10px auto 0; height: 1px; background: var(--border); opacity: 0.9; }
    .terminal { border-radius: 16px; border: 1px solid var(--border); overflow: hidden; background: rgba(13,13,21,0.9); box-shadow: 0 12px 40px rgba(0,0,0,0.55); }
    .termbar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: rgba(10,10,18,0.95); border-bottom: 1px solid var(--border); }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot.red { background: #ff5f57; } .dot.yellow { background:#ffbd2e; } .dot.green { background:#28c840; }
    .termtitle { margin-left: 10px; font-family: "JetBrains Mono", monospace; font-size: 12px; color: rgba(136,136,153,0.95); }
    .termbody { padding: 12px; }
    .termbody pre { border: 0; background: transparent; padding: 0; }
    .termbody code { font-size: 12px; }
    .cmt { color: rgba(136,136,153,0.9); }
    .grn { color: rgba(0,212,170,0.95); }
    .hero-notes { margin-top: 12px; display: grid; gap: 10px; }
    .note { background: rgba(17,17,25,0.7); border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; color: var(--muted); }
    .note code { color: var(--text); font-family: "JetBrains Mono", monospace; font-size: 12px; }
    .tag { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(26,26,40,0.9); background: rgba(255,255,255,0.04); color: var(--text); font-family: "JetBrains Mono", monospace; font-size: 11px; margin-right: 8px; }

    /* Luxury blocks */
    .lux{ max-width: 1180px; margin: 0 auto; padding: 0 18px 22px 18px; }
    .lux-grid{ display:grid; grid-template-columns: 1.2fr 1fr 1.1fr; gap: 14px; }
    @media (max-width: 980px){ .lux-grid{ grid-template-columns: 1fr; } }

    .lux-card{
      background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 16px 50px rgba(0,0,0,0.35);
    }
    .lux-title{
      font-family:"Space Grotesk", system-ui;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.25px;
      text-transform: uppercase;
      color: var(--text);
      opacity: 0.95;
    }
    .lux-sub{ margin-top: 8px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .lux-foot{ margin-top: 10px; font-size: 12px; }

    .pricing{ margin-top: 12px; border: 1px solid var(--border); border-radius: 12px; overflow:hidden; }
    .pricing-row{
      display:flex; justify-content:space-between; align-items:center;
      padding: 10px 12px;
      font-family:"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas;
      font-size: 12px;
      border-top: 1px solid rgba(26,26,40,0.7);
      background: rgba(17,17,25,0.55);
    }
    .pricing-row:first-child{ border-top:none; }
    .pricing-name{ color: var(--text); opacity: 0.92; }
    .pricing-cost{ color: var(--accent); font-weight: 700; }

    .authbox{ margin-top: 12px; }
    .authinput{
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(17,17,25,0.55);
      color: var(--text);
      font-family:"JetBrains Mono", ui-monospace;
      font-size: 12px;
      outline: none;
    }
    .authinput:focus{ box-shadow: 0 0 0 3px rgba(0,212,170,0.15); border-color: rgba(0,212,170,0.35); }
    .authactions{ display:flex; gap:10px; margin-top: 10px; }
    .btn2{
      border: 1px solid rgba(26,26,40,0.9);
      background: rgba(17,17,25,0.75);
      color: var(--text);
      border-radius: 12px;
      padding: 8px 12px;
      font-weight: 700;
      font-size: 12px;
      cursor:pointer;
    }
    .btn2:hover{ border-color: rgba(0,212,170,0.45); }
    .btn2.ghost{ opacity: 0.75; }
    .authstatus{ margin-top: 10px; font-size: 12px; }

</style>
</head>
<body>
  <div class="topline"></div>
  <header>
    <div class="brand">
      <div class="mark">A</div>
      <div>
        <h1>Arch Tools API</h1>
        <div class="subtitle">Production-ready APIs for developers and AI agents — tool discovery, agent auth, credits, and Stripe billing. Use <strong>Authorization: Bearer</strong> with your agent API key.</div>
        <div class="quickstart">
          <span class="pill">GET /v1/tools</span>
          <span class="pill">POST /v1/agent/register</span>
          <span class="pill">GET /v1/agent/usage</span>
          <span class="pill">POST /v1/checkout</span>
          <span class="pill">POST /v1/tools/:toolName</span>
        </div>
      </div>

      <div class="kicker" style="margin-top:18px;">Common issues (fast fixes)</div>
      <div class="card" id="errorsCard"></div>
    </div>
    <div class="links">
      <a class="btn" href="https://archtools.dev" target="_blank" rel="noreferrer">archtools.dev</a>
      <a class="btn" href="/openapi.json" target="_blank" rel="noreferrer">OpenAPI JSON</a>
      <a class="btn" href="/legal" target="_blank" rel="noreferrer">Legal</a>
      <a class="btn" href="/postman.json" target="_blank" rel="noreferrer">Postman</a>
      <a class="btn" href="/postman-env.json" target="_blank" rel="noreferrer">Postman Env</a>
      <a class="btn" href="/.well-known/security.txt" target="_blank" rel="noreferrer">security.txt</a>
      <a class="btn" href="/changelog" target="_blank" rel="noreferrer">Changelog</a>
      <a class="btn" href="/.well-known/x402" target="_blank" rel="noreferrer">x402</a>
    </div>
  </header>
  <section class="hero">
    <div class="hero-left">
      <div class="kicker">Quickstart</div>
      <h2>Make your first authenticated tool call in under 60 seconds.</h2>
      <p class="hero-sub">Register an agent, grab your API key, then call any tool by name. Credits are deducted automatically and usage is tracked per agent.</p>

      <div class="steps">
        <div class="step">
          <div class="step-title">1) Register an agent</div>
          <div class="codewrap">
            <button class="copy" data-copy="#code-register">Copy</button>
            <pre id="code-register"><code>curl -s -X POST \
  "\${API_BASE}/v1/agent/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Agent","email":"me@example.com"}'</code></pre>
          </div>
        </div>

        <div class="step">
          <div class="step-title">2) Discover tools</div>
          <div class="codewrap">
            <button class="copy" data-copy="#code-tools">Copy</button>
            <pre id="code-tools"><code>curl -s "\${API_BASE}/v1/tools" \
  -H "Authorization: Bearer YOUR_API_KEY"</code></pre>
          </div>
        </div>

        <div class="step">
          <div class="step-title">3) Invoke a tool (example: web-scrape)</div>
          <div class="codewrap">
            <button class="copy" data-copy="#code-invoke">Copy</button>
            <pre id="code-invoke"><code>curl -s -X POST \
  "\${API_BASE}/v1/tools/web-scrape" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","mode":"readable"}'</code></pre>
          </div>
        </div>
      </div>
    </div>

    <div class="hero-right">
      <div class="terminal">
        <div class="termbar">
          <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
          <span class="termtitle">Terminal — Arch Tools</span>
        </div>
        <div class="termbody">
<pre><code><span class="cmt"># Invoke web-scrape</span>
<span class="grn">$</span> curl -s -X POST "\${API_BASE}/v1/tools/web-scrape" \
  -H "Authorization: Bearer arch_..." \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","mode":"readable"}'

{
  "ok": true,
  "tool": "web-scrape",
  "credits_used": 5,
  "credits_remaining": 95,
  "result": {
    "title": "Example Domain",
    "text": "This domain is for use in illustrative examples..."
  },
  "request_id": "req_01H..."
}</code></pre>
        </div>
      </div>

      <div class="hero-notes">
        <div class="note"><span class="tag">Auth</span> Use <code>Authorization: Bearer &lt;api_key&gt;</code>.</div>
        <div class="note"><span class="tag">Pricing</span> Tool costs are returned by <code>GET /v1/tools</code>.</div>
        <div class="note"><span class="tag">Payments</span> Use <code>POST /v1/checkout</code> to purchase credit packs via Stripe.</div>
      </div>
    </div>
  </section>

  <div class="divider"></div>

  <section class="lux">
    <div class="lux-grid">
      <div class="lux-card">
        <div class="lux-title">Pricing at a glance</div>
        <div class="lux-sub">Live tool costs from <code>GET /v1/tools</code>.</div>
        <div id="pricing" class="pricing">
          <div class="pricing-row muted">Loading…</div>
        </div>
      </div>

      <div class="lux-card">
        <div class="lux-title">Auth helper</div>
        <div class="lux-sub">Paste your agent API key once — Swagger requests will auto-include <code>Authorization: Bearer</code>.</div>
        <div class="authbox">
          <input id="apiKeyInput" class="authinput" type="password" placeholder="arch_… (stored locally in this browser)" autocomplete="off" />
          <div class="authactions">
            <button id="saveKey" class="btn2">Save</button>
            <button id="clearKey" class="btn2 ghost">Clear</button>
          </div>
          <div id="authStatus" class="authstatus muted">Not set.</div>
        </div>
      </div>

      <div class="lux-card">
        <div class="lux-title">MCP config</div>
        <div class="lux-sub">Use Arch Tools as an MCP server (SSE) in hosted agents or web clients.</div>
        <div class="codewrap">
          <button class="copy" data-copy="#code-mcp">Copy</button>
          <pre id="code-mcp"><code>{
  "mcpServers": {
    "arch-tools": {
      "transport": "sse",
      "url": "\${API_BASE}/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}</code></pre>
        </div>
        <div class="lux-foot muted">Prefer local CLI? Use Stdio transport in the MCP package.</div>
      </div>
    </div>
  </section>

  <div id="swagger" class="swagger-ui"></div>


  <script src="https://unpkg.com/swagger-ui-dist@${swaggerVersion}/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@${swaggerVersion}/swagger-ui-standalone-preset.js"></script>
  <script>
    const ERROR_REGISTRY = ${ERRORS_JSON};
    
    const API_BASE = window.location.origin;
    function hydrateExamples(){
      const blocks = document.querySelectorAll("pre code");
      blocks.forEach((b) => {
        b.textContent = b.textContent.replaceAll("\${API_BASE}", API_BASE);
      });
    }
    function wireCopy(){
      document.querySelectorAll("button.copy").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const sel = btn.getAttribute("data-copy");
          const el = sel ? document.querySelector(sel) : null;
          const text = el ? el.textContent : "";
          try{
            await navigator.clipboard.writeText(text.trim());
            const prev = btn.textContent;
            btn.textContent = "Copied";
            setTimeout(()=> btn.textContent = prev, 900);
          }catch(e){
            // fallback
            const ta = document.createElement("textarea");
            ta.value = text.trim();
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            const prev = btn.textContent;
            btn.textContent = "Copied";
            setTimeout(()=> btn.textContent = prev, 900);
          }
        });
      });
    }


    function getStoredKey(){
      try{ return (localStorage.getItem("archtools_api_key") || "").trim(); }catch(e){ return ""; }
    }
    function setStoredKey(v){
      try{ localStorage.setItem("archtools_api_key", (v||"").trim()); }catch(e){}
    }
    function clearStoredKey(){
      try{ localStorage.removeItem("archtools_api_key"); }catch(e){}
    }
    function maskKey(k){
      if(!k) return "";
      if(k.length <= 10) return "••••••";
      return k.slice(0, 6) + "…" + k.slice(-4);
    }

    async function hydratePricing(){
      const el = document.getElementById("pricing");
      if(!el) return;
      const key = getStoredKey();
      try{
        const resp = await fetch(String(API_BASE) + "/v1/tools", {
          headers: key ? { "Authorization": "Bearer " + key } : {}
        });
        if(!resp.ok){
          const msg = resp.status===401 ? "Set your API key to view." : "";
          el.innerHTML = '<div class="pricing-row muted">Unable to load pricing (' + resp.status + '). ' + msg + '</div>';
          return;
        }
        const data = await resp.json();
        const tools = (data && data.tools) ? data.tools : [];
        if(!tools.length){
          el.innerHTML = '<div class="pricing-row muted">No tools returned.</div>';
          return;
        }
        el.innerHTML = tools
          .sort((a,b)=> (a.price||0)-(b.price||0))
          .map(t =>
            '<div class="pricing-row">' +
              '<div class="pricing-name">' + (t.name||"") + '</div>' +
              '<div class="pricing-cost">' + (t.price||0) + ' credits</div>' +
            '</div>'
          ).join("");
      }catch(e){
        el.innerHTML = '<div class="pricing-row muted">Unable to load pricing.</div>';
      }
    }

    function wireAuthHelper(){
      const input = document.getElementById("apiKeyInput");
      const save = document.getElementById("saveKey");
      const clear = document.getElementById("clearKey");
      const status = document.getElementById("authStatus");

      const existing = getStoredKey();
      if(existing && input){
        input.value = existing;
      }
      if(status){
        status.textContent = existing ? ("Saved: " + maskKey(existing) + " (stored locally)") : "Not set.";
      }

      if(save){
        save.addEventListener("click", () => {
          const v = input ? input.value.trim() : "";
          if(!v){
            clearStoredKey();
            if(status) status.textContent = "Not set.";
          } else {
            setStoredKey(v);
            if(status) status.textContent = "Saved: " + maskKey(v) + " (stored locally)";
          }
          // Refresh pricing + reload swagger (so Try It Out uses the latest key)
          hydratePricing();
          if(window.ui && window.ui.getSystem){
            // Swagger UI reads requestInterceptor live, so no hard reload required
          }
        });
      }
      if(clear){
        clear.addEventListener("click", () => {
          if(input) input.value = "";
          clearStoredKey();
          if(status) status.textContent = "Not set.";
          hydratePricing();
        });
      }
    }

    function renderErrors(){
      const el = document.getElementById("errorsCard");
      if(!el) return;
      const items = (ERROR_REGISTRY || []).map(e =>
        '<div style="padding:10px 0;border-top:1px solid rgba(26,26,40,0.6)">' +
          '<div style="font-weight:800; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color: var(--dim)">' + (e.code||"") + '</div>' +
          '<div style="font-weight:800; margin-top:4px;">' + (e.title||"") + '</div>' +
          '<div style="color:var(--dim); margin-top:4px; line-height:1.5;">' + (e.whatItMeans||"") + '</div>' +
          '<div style="margin-top:6px;"><span class="pill" style="border-color: rgba(0,212,170,0.25); color: var(--accent);">Fix</span> ' +
            '<span style="color:var(--text);">' + (e.fastFix||"") + '</span>' +
          '</div>' +
        '</div>'
      ).join("");
      el.innerHTML = '<div style="padding-top:0">' + items + '</div>';
    }


window.onload = function() {
      hydrateExamples();
      wireCopy();
      wireAuthHelper();
      hydratePricing();
      renderErrors();

      const ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "BaseLayout",
        defaultModelsExpandDepth: -1,
        displayRequestDuration: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
        requestInterceptor: (req) => {
          const k = getStoredKey();
          if(k){
            req.headers = req.headers || {};
            if(!req.headers["Authorization"] && !req.headers["authorization"]){
              req.headers["Authorization"] = "Bearer " + k;
            }
          }
          return req;
        },

      });
      window.ui = ui;
    };
  </script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
});
