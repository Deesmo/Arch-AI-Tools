/**
 * Free SEO Tool Pages — v15
 *
 * Three free, no-auth-required tool pages that:
 * - Rank in Google for high-volume search terms
 * - Demo the API quality
 * - Funnel users to paid signup
 *
 * Routes: /tools/qr-code | /tools/hash | /tools/text-transform
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";

const router = Router();

const NAV = `<nav style="background:#0f172a;padding:12px 24px;display:flex;align-items:center;justify-content:space-between">
  <a href="/" style="color:#fff;font-weight:700;font-size:18px;text-decoration:none">⚡ Arch Tools</a>
  <div style="display:flex;gap:16px">
    <a href="/tools/qr-code" style="color:#94a3b8;text-decoration:none;font-size:14px">QR Code</a>
    <a href="/tools/hash" style="color:#94a3b8;text-decoration:none;font-size:14px">Hash</a>
    <a href="/tools/text-transform" style="color:#94a3b8;text-decoration:none;font-size:14px">Text Transform</a>
    <a href="https://archtools.dev/pricing" style="background:#6366f1;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:14px">API Access →</a>
  </div>
</nav>`;

const CTA = `<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-top:32px;text-align:center">
  <h3 style="color:#fff;margin:0 0 8px">Want this via API?</h3>
  <p style="color:#94a3b8;margin:0 0 16px;font-size:14px">Access all 63 tools programmatically. Get 250 free credits — no credit card required.</p>
  <a href="https://archtools.dev/signup" style="background:#6366f1;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">Get Free API Key →</a>
</div>`;

const FOOTER = `<footer style="text-align:center;padding:32px;color:#475569;font-size:13px">
  <p>© ${new Date().getFullYear()} Arch Tools · <a href="https://archtools.dev" style="color:#6366f1">archtools.dev</a> · 63 API tools for developers and AI agents</p>
</footer>`;

// GET /tools/qr-code — Free QR Code Generator
router.get("/qr-code", (_req: Request, res: Response): void => {
  res.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Free QR Code Generator — Arch Tools</title>
  <meta name="description" content="Generate QR codes instantly for free. Enter any URL or text and download your QR code as PNG or SVG. No signup required.">
  <style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0}
  .container{max-width:640px;margin:40px auto;padding:0 20px}
  h1{font-size:2rem;font-weight:800;color:#fff;margin-bottom:8px}
  p.sub{color:#94a3b8;margin-bottom:24px}
  input,select{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:15px;margin-bottom:12px}
  button{background:#6366f1;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;width:100%}
  button:hover{background:#4f46e5}
  #result{margin-top:24px;text-align:center}
  #qrimg{max-width:256px;border-radius:8px;background:#fff;padding:8px}
  .dl{display:inline-block;margin-top:12px;background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px}
  </style>
</head>
<body>
${NAV}
<div class="container">
  <h1>Free QR Code Generator</h1>
  <p class="sub">Generate QR codes instantly. Enter any URL, text, or phone number — no signup required.</p>
  <input id="text" type="text" placeholder="https://archtools.dev" value="">
  <select id="format"><option value="png">PNG (image)</option><option value="svg">SVG (vector)</option></select>
  <button onclick="generate()">Generate QR Code</button>
  <div id="result"></div>
  ${CTA}
</div>
${FOOTER}
<script>
async function generate() {
  const text = document.getElementById('text').value.trim();
  const format = document.getElementById('format').value;
  if (!text) { alert('Please enter text or URL'); return; }
  document.getElementById('result').innerHTML = '<p style="color:#94a3b8">Generating…</p>';
  try {
    const r = await fetch('/v1/tools/qr-code-free', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({text, format})
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.message);
    if (format === 'svg') {
      document.getElementById('result').innerHTML = d.data + '<br><a class="dl" download="qr.svg" href="data:image/svg+xml;base64,' + btoa(d.data) + '">⬇ Download SVG</a>';
    } else {
      document.getElementById('result').innerHTML = '<img id="qrimg" src="' + d.data + '"><br><a class="dl" download="qr.png" href="' + d.data + '">⬇ Download PNG</a>';
    }
  } catch(e) { document.getElementById('result').innerHTML = '<p style="color:#f87171">Error: ' + e.message + '</p>'; }
}
</script>
</body></html>`);
});

// GET /tools/hash — Free Hash Generator
router.get("/hash", (_req: Request, res: Response): void => {
  res.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Free Hash Generator (SHA256, MD5, SHA512) — Arch Tools</title>
  <meta name="description" content="Generate cryptographic hashes instantly. SHA256, SHA512, MD5, SHA1 — free, online, no signup. Useful for checksums, password hashing, and data integrity.">
  <style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0}
  .container{max-width:640px;margin:40px auto;padding:0 20px}
  h1{font-size:2rem;font-weight:800;color:#fff;margin-bottom:8px}
  p.sub{color:#94a3b8;margin-bottom:24px}
  textarea{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:14px;margin-bottom:12px;min-height:100px;resize:vertical}
  select{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:15px;margin-bottom:12px}
  button{background:#6366f1;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;width:100%}
  .result{margin-top:24px;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:16px;font-family:monospace;word-break:break-all;font-size:14px;color:#34d399}
  .copy{float:right;background:none;border:1px solid #334155;color:#94a3b8;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;width:auto;margin:0}
  </style>
</head>
<body>
${NAV}
<div class="container">
  <h1>Free Hash Generator</h1>
  <p class="sub">Generate cryptographic hashes for any text. SHA256, SHA512, MD5, SHA1 — runs locally, nothing stored.</p>
  <textarea id="text" placeholder="Enter text to hash…"></textarea>
  <select id="algo"><option value="sha256">SHA-256</option><option value="sha512">SHA-512</option><option value="md5">MD5</option><option value="sha1">SHA-1</option><option value="sha384">SHA-384</option></select>
  <button onclick="generate()">Generate Hash</button>
  <div id="result"></div>
  ${CTA}
</div>
${FOOTER}
<script>
async function generate() {
  const text = document.getElementById('text').value;
  const algo = document.getElementById('algo').value;
  if (!text) { alert('Please enter text'); return; }
  try {
    const r = await fetch('/v1/tools/hash-free', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({text, algorithm: algo})
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.message);
    document.getElementById('result').innerHTML = '<div class="result"><button class="copy" onclick="navigator.clipboard.writeText(document.querySelector(\'.result code\').textContent)">Copy</button><code>' + d.hash + '</code></div><p style="color:#94a3b8;font-size:13px;margin-top:8px">Algorithm: ' + d.algorithm.toUpperCase() + ' · Length: ' + d.length + ' chars</p>';
  } catch(e) { document.getElementById('result').innerHTML = '<p style="color:#f87171">Error: ' + e.message + '</p>'; }
}
</script>
</body></html>`);
});

// GET /tools/text-transform — Free Text Transformer
router.get("/text-transform", (_req: Request, res: Response): void => {
  res.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Free Text Transformer — Slug, camelCase, Base64, Snake Case — Arch Tools</title>
  <meta name="description" content="Transform text instantly. Convert to slug, camelCase, snake_case, base64, UPPERCASE, titlecase and more. Free online tool, no signup.">
  <style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0}
  .container{max-width:640px;margin:40px auto;padding:0 20px}
  h1{font-size:2rem;font-weight:800;color:#fff;margin-bottom:8px}
  p.sub{color:#94a3b8;margin-bottom:24px}
  textarea{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:14px;margin-bottom:12px;min-height:80px;resize:vertical}
  .modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
  .mode{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;cursor:pointer;font-size:14px;text-align:left;color:#94a3b8;transition:all .15s}
  .mode:hover,.mode.active{border-color:#6366f1;color:#fff;background:#1e293b}
  .result{margin-top:24px;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:16px;word-break:break-all;font-size:15px;color:#34d399;position:relative}
  .copy{position:absolute;top:12px;right:12px;background:none;border:1px solid #334155;color:#94a3b8;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px}
  </style>
</head>
<body>
${NAV}
<div class="container">
  <h1>Free Text Transformer</h1>
  <p class="sub">Convert text to any case or format instantly. Click a mode, see the result.</p>
  <textarea id="text" placeholder="Hello World Example Text" oninput="transform()">Hello World Example Text</textarea>
  <div class="modes">
    ${["uppercase","lowercase","titlecase","slug","camel","snake","kebab","base64_encode","base64_decode","reverse"].map(m => `<button class="mode${m==="slug"?" active":""}" onclick="setMode('${m}')" id="btn_${m}">${m}</button>`).join("")}
  </div>
  <div id="result"></div>
  ${CTA}
</div>
${FOOTER}
<script>
let mode = 'slug';
function setMode(m) {
  mode = m;
  document.querySelectorAll('.mode').forEach(b => b.classList.remove('active'));
  document.getElementById('btn_' + m).classList.add('active');
  transform();
}
async function transform() {
  const text = document.getElementById('text').value;
  if (!text) return;
  try {
    const r = await fetch('/v1/tools/transform-free', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({text, mode})
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.message);
    document.getElementById('result').innerHTML = '<div class="result"><button class="copy" onclick="navigator.clipboard.writeText(document.getElementById(\\'output\\').textContent)">Copy</button><span id="output">' + String(d.result).replace(/</g,'&lt;') + '</span></div>';
  } catch(e) {}
}
transform();
</script>
</body></html>`);
});

// ─── Free (no-auth) API endpoints for the SEO pages ──────────────────────────

router.post("/qr-code-free", async (req: Request, res: Response): Promise<void> => {
  const { text, format = "png" } = req.body as { text?: string; format?: string };
  if (!text) { res.status(400).json({ ok: false, message: "text is required" }); return; }
  if (text.length > 500) { res.status(400).json({ ok: false, message: "Text too long for free tier (max 500 chars)" }); return; }
  try {
    const QRCode = await import("qrcode");
    if (format === "svg") {
      const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M" });
      res.json({ ok: true, format: "svg", data: svg });
    } else {
      const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: "M", width: 256 });
      res.json({ ok: true, format: "png", data: dataUrl });
    }
  } catch (e) {
    res.status(500).json({ ok: false, message: String(e) });
  }
});

router.post("/hash-free", (req: Request, res: Response): void => {
  const { text, algorithm = "sha256" } = req.body as { text?: string; algorithm?: string };
  if (!text) { res.status(400).json({ ok: false, message: "text is required" }); return; }
  if (text.length > 10000) { res.status(400).json({ ok: false, message: "Text too long for free tier (max 10000 chars)" }); return; }
  const algos = ["sha256", "sha512", "sha1", "md5", "sha384"];
  const algo = algos.includes(algorithm) ? algorithm : "sha256";
  const hash = crypto.createHash(algo).update(text, "utf8").digest("hex");
  res.json({ ok: true, hash, algorithm: algo, length: hash.length });
});

router.post("/transform-free", (req: Request, res: Response): void => {
  const { text, mode } = req.body as { text?: string; mode?: string };
  if (!text || !mode) { res.status(400).json({ ok: false, message: "text and mode required" }); return; }
  if (text.length > 5000) { res.status(400).json({ ok: false, message: "Text too long for free tier" }); return; }
  const words = text.trim().split(/\s+/);
  let result: string | number;
  switch (mode) {
    case "uppercase": result = text.toUpperCase(); break;
    case "lowercase": result = text.toLowerCase(); break;
    case "titlecase": result = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" "); break;
    case "slug": result = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); break;
    case "camel": result = words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""); break;
    case "snake": result = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); break;
    case "kebab": result = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); break;
    case "base64_encode": result = Buffer.from(text, "utf8").toString("base64"); break;
    case "base64_decode": result = Buffer.from(text, "base64").toString("utf8"); break;
    case "reverse": result = text.split("").reverse().join(""); break;
    default: result = text;
  }
  res.json({ ok: true, result, mode });
});

export default router;
