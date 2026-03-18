import Link from 'next/link'

// ─── Tool categories (38 tools across 13 categories) ─────
const TOOL_CATEGORIES = [
  { cat: 'Data',          tools: 'validate · convert · diff · JSONPath',     icon: '⬡' },
  { cat: 'Text',          tools: 'transform · summarize · readability',       icon: '≋' },
  { cat: 'AI',            tools: 'generate · OCR · NER · sentiment',         icon: '◈' },
  { cat: 'Web',           tools: 'scrape · search · RSS · extract',          icon: '⊕' },
  { cat: 'Browser',       tools: 'Playwright automation · screenshot',       icon: '⊞' },
  { cat: 'Image',         tools: 'DALL-E · Stability AI generation',        icon: '◻' },
  { cat: 'URL / Webhook', tools: 'url-shorten · webhook-send',             icon: '⇢' },
  { cat: 'Security',      tools: 'hash · PII detect',                       icon: '⊛' },
  { cat: 'Network',       tools: 'IP lookup · WHOIS',                      icon: '⊗' },
  { cat: 'Validate',      tools: 'email · phone',                           icon: '✓' },
  { cat: 'Finance',       tools: 'currency convert',                        icon: '$' },
  { cat: 'Utilities',     tools: 'UUID · timezone · QR · barcode',         icon: '⊜' },
  { cat: 'HTML → MD',     tools: 'html-to-markdown converter',             icon: '≡' },
]

// ─── MCP client compatibility ─────────────────────────────
const MCP_CLIENTS = [
  { name: 'Claude Code',      sub: '#1 AI coding tool 2026',  color: '#CC785C', hot: true  },
  { name: 'ChatGPT / GPT-5',  sub: 'OpenAI MCP protocol',    color: '#74AA9C', hot: false },
  { name: 'GitHub Copilot',   sub: 'Agent Mode · 15M users', color: '#A5B4FC', hot: false },
  { name: 'Cursor',           sub: 'Native MCP support',     color: '#818CF8', hot: false },
  { name: 'Windsurf',         sub: 'Native MCP support',     color: '#46E3B7', hot: false },
  { name: 'Gemini AI Studio', sub: 'Google MCP servers',     color: '#4285F4', hot: false },
  { name: 'Kiro',             sub: 'Amazon · MCP native',    color: '#FF9900', hot: false },
  { name: 'Cline / Continue', sub: 'Open-source agents',     color: '#22D3EE', hot: false },
]

// ─── Trust badges ─────────────────────────────────────────
const TRUST_BADGES = [
  { name: 'Claude API',   dot: '#CC785C', delay: '0.2s'  },
  { name: 'MCP Protocol', dot: '#818CF8', delay: '0.35s' },
  { name: 'x402 / USDC',  dot: '#2775CA', delay: '0.5s'  },
  { name: 'Stripe',       dot: '#7772F8', delay: '0.65s' },
  { name: 'Render',       dot: '#46E3B7', delay: '0.8s'  },
  { name: 'Python SDK',   dot: '#3776AB', delay: '0.95s' },
  { name: 'Node.js SDK',  dot: '#68A063', delay: '1.1s'  },
]

// ─── Animated code block ──────────────────────────────────
function AnimatedCodeBlock() {
  const commentStyle = { color: 'rgba(110,231,183,0.45)' }
  const keyStyle     = { color: 'rgba(167,139,250,0.9)'  }
  const strStyle     = { color: 'rgba(103,232,249,0.85)' }
  const dimStyle     = { color: 'rgba(255,255,255,0.45)' }
  const valStyle     = { color: 'rgba(255,255,255,0.8)'  }

  type LineToken = { text: string; style?: React.CSSProperties }
  type Line      = { tokens: LineToken[]; delay: number }

  const lines: Line[] = [
    { delay: 0.3,  tokens: [{ text: '// Screenshot + summarize — two tools, one pipeline', style: commentStyle }] },
    { delay: 0.6,  tokens: [{ text: 'const shot = ', style: valStyle }, { text: 'await ', style: keyStyle }, { text: 'fetch(', style: valStyle }] },
    { delay: 0.8,  tokens: [{ text: "  '", style: dimStyle }, { text: 'https://archtools.dev/v1/tools/screenshot-capture', style: strStyle }, { text: "'", style: dimStyle }] },
    { delay: 1.0,  tokens: [{ text: '  { method: ', style: dimStyle }, { text: "'POST'", style: strStyle }, { text: ', headers: {', style: dimStyle }] },
    { delay: 1.15, tokens: [{ text: "    Authorization: ", style: keyStyle }, { text: "'Bearer at_sk_...'", style: strStyle }] },
    { delay: 1.3,  tokens: [{ text: '  }, body: ', style: dimStyle }, { text: 'JSON.stringify', style: keyStyle }, { text: '({ url: ', style: dimStyle }, { text: "'https://example.com'", style: strStyle }, { text: ', full_page: ', style: dimStyle }, { text: 'true', style: keyStyle }, { text: ' })', style: dimStyle }] },
    { delay: 1.45, tokens: [{ text: '})', style: valStyle }] },
  ]

  const responseJson = `{
  "ok": true,
  "format": "png",
  "image": "data:image/png;base64,...",
  "width": 1280,
  "height": 2480,
  "latency_ms": 1841
}`

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
      <div className="flex items-center gap-1.5 px-1 pb-1">
        <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
        <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
        <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
        <span className="ml-2 text-xs text-white/30 font-mono">arch-tools-pipeline.ts</span>
        <span className="ml-auto text-[10px] text-white/20 font-mono">TypeScript</span>
      </div>

      <div className="rounded-xl bg-black/50 p-4 font-mono text-xs leading-relaxed overflow-auto">
        {lines.map((line, i) => (
          <span key={i} className="code-line" style={{ animationDelay: `${line.delay}s` }}>
            {line.tokens.map((tok, j) => (
              <span key={j} style={tok.style}>{tok.text}</span>
            ))}
          </span>
        ))}
        <span className="code-cursor code-cursor-visible" style={{ animationDelay: '1.6s' }} />
      </div>

      <div
        className="code-line response-block rounded-xl border border-emerald-500/15 p-4 font-mono text-xs leading-relaxed"
        style={{ animationDelay: '1.9s' }}
      >
        <span className="code-line" style={{ animationDelay: '1.9s', ...commentStyle }}>
          {'// → Response (1841ms — full-page screenshot, 1280×2480)'}
        </span>
        <pre className="mt-1 text-emerald-300/80 overflow-auto">{responseJson}</pre>
      </div>

      <div className="flex items-center justify-between text-xs text-white/40 px-1 pt-1">
        <div className="flex items-center gap-3">
          <span className="text-emerald-400/70">38 tools</span>
          <span>·</span>
          <span>screenshot · image gen · webhook · barcode</span>
          <span>·</span>
          <span>MCP · x402</span>
        </div>
        <Link className="text-white/60 hover:text-white transition-colors" href="/docs">Open docs →</Link>
      </div>
    </div>
  )
}

// ─── Pill badge ───────────────────────────────────────────
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/65">
      {children}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────
export default function HomePage() {
  return (
    <div className="pt-12">
      <div className="flex flex-col gap-16">

        {/* ── Hero ── */}
        <div className="relative flex flex-col gap-6 rounded-3xl overflow-hidden">
          <div className="hero-grid absolute inset-0 rounded-3xl pointer-events-none" aria-hidden="true" />
          <div
            className="absolute -top-20 left-1/2 -translate-x-1/2 w-[700px] h-[350px] pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.14) 0%, transparent 70%)' }}
            aria-hidden="true"
          />

          <div className="relative flex flex-col gap-6 pt-2">
            <div className="flex flex-wrap gap-2">
              <Pill>38 production tools</Pill>
              <Pill>Universal MCP</Pill>
              <Pill>Screenshot &amp; image gen</Pill>
              <Pill>Webhook · barcode · JSONPath</Pill>
              <Pill>x402 / USDC</Pill>
              <Pill>Python &amp; Node.js SDKs</Pill>
            </div>

            <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-6xl">
              The API toolkit{' '}
              <span className="grad-animate">AI agents pay for themselves.</span>
            </h1>

            <p className="max-w-2xl text-pretty text-lg text-white/65 leading-relaxed">
              38 production-ready tools — screenshot capture, image generation, webhooks, barcodes,
              HTML-to-Markdown, and 33 more — with MCP support for every major AI coding assistant,
              credit billing, and x402 USDC so agents fund their own pipelines without human sign-off.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/signin"
                className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors"
              >
                Get API key free →
              </Link>
              <Link
                href="/playground"
                className="rounded-2xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white/75 hover:border-white/30 hover:text-white transition-colors"
              >
                Try the playground
              </Link>
              <Link
                href="/docs"
                className="rounded-2xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white/75 hover:border-white/30 hover:text-white transition-colors"
              >
                View docs
              </Link>
            </div>

            <div className="flex flex-wrap gap-8 pt-4 border-t border-white/8">
              {[
                { value: '38',     label: 'production tools'     },
                { value: '500',    label: 'free credits on signup'},
                { value: '$0.001', label: 'cheapest tool call'   },
                { value: 'MCP',    label: 'universal protocol'   },
              ].map(({ value, label }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-xl font-bold tracking-tight text-white">{value}</span>
                  <span className="text-xs text-white/40">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Trust / Powered-by bar ── */}
        <div className="flex flex-col gap-3">
          <p className="text-[11px] text-white/30 font-mono tracking-widest uppercase">Powered by</p>
          <div className="flex flex-wrap gap-2">
            {TRUST_BADGES.map(({ name, dot, delay }) => (
              <div
                key={name}
                className="trust-badge inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-white/60 hover:border-white/20 hover:text-white/80 transition-colors"
                style={{ animationDelay: delay }}
              >
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: dot, boxShadow: `0 0 6px ${dot}` }} />
                {name}
              </div>
            ))}
          </div>
        </div>

        {/* ── Universal MCP Compatibility ── */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-white/30 font-mono tracking-widest uppercase">Works with every MCP client</p>
            <h2 className="text-xl font-semibold text-white">
              One server. Every AI assistant.
            </h2>
            <p className="max-w-2xl text-sm text-white/55 leading-relaxed">
              MCP is now the universal protocol — adopted by every major AI coding tool in 2025–2026.
              Arch Tools runs as a single MCP server that any of these clients can discover and use immediately,
              with no per-client configuration.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {MCP_CLIENTS.map(({ name, sub, color, hot }) => (
              <div
                key={name}
                className={`relative rounded-2xl border p-4 flex flex-col gap-2 hover:bg-white/[0.04] transition-colors ${
                  hot ? 'border-orange-500/30 bg-orange-500/[0.04]' : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                {hot && (
                  <div className="absolute top-3 right-3 text-[10px] font-semibold text-orange-300/80 bg-orange-500/15 border border-orange-500/20 rounded-full px-2 py-0.5">
                    🔥 hot
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 5px ${color}` }} />
                  <span className="text-xs font-semibold text-white/85 leading-tight">{name}</span>
                </div>
                <div className="text-[11px] text-white/40 leading-snug">{sub}</div>
                <div className="flex items-center gap-1 text-[11px] text-emerald-400/70 font-medium">
                  <span>✓</span>
                  <span>Compatible</span>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-5 py-4 flex items-start gap-3">
            <span className="text-indigo-400/70 text-sm shrink-0 mt-0.5">🔌</span>
            <div>
              <span className="text-sm text-white/70 font-medium">Single MCP server URL: </span>
              <code className="text-sm font-mono text-cyan-300/80">https://archtools.dev/mcp</code>
              <span className="text-sm text-white/40"> — paste this into any MCP client to unlock all 38 tools instantly.</span>
            </div>
          </div>
        </div>

        {/* ── Animated code block ── */}
        <AnimatedCodeBlock />

        {/* ── Feature cards ── */}
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: 'Trustworthy by design',
              desc:  'Hashed API keys, SSRF-hardened scraping, disposable email blocking, Cloudflare Turnstile CAPTCHA, rate limits, and Sentry error tracking.',
              icon:  '🔐',
            },
            {
              title: 'Built for agents',
              desc:  'Tool discovery via /v1/tools, multi-step workflow runner with $last chaining, MCP server, and x402 USDC payments — agents self-fund autonomously.',
              icon:  '🤖',
            },
            {
              title: 'Developer-first',
              desc:  'Interactive playground, OpenAPI spec, Postman collection, Python + Node.js SDKs, magic-link signup. No card required to start.',
              icon:  '⚡',
            },
          ].map((x) => (
            <div
              key={x.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 hover:bg-white/[0.05] transition-colors"
            >
              <div className="text-2xl mb-3">{x.icon}</div>
              <div className="text-sm font-semibold text-white">{x.title}</div>
              <div className="mt-2 text-sm text-white/55 leading-relaxed">{x.desc}</div>
            </div>
          ))}
        </div>

        {/* ── New tools spotlight ── */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-white/30 font-mono tracking-widest uppercase">New in this release</p>
            <h2 className="text-xl font-semibold text-white">8 new tools — all production-ready</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[
              { name: 'screenshot-capture', desc: 'Full-page or viewport screenshot via Playwright. Returns base64 PNG.', credits: '10 cr', icon: '📸', hot: true  },
              { name: 'image-generate',     desc: 'DALL-E 3 + Stability AI image generation from a text prompt.',         credits: '15 cr', icon: '🎨', hot: true  },
              { name: 'html-to-markdown',   desc: 'Convert any HTML string or URL into clean Markdown for agent context windows.', credits: '3 cr', icon: '📝', hot: false },
              { name: 'url-shorten',        desc: 'Shorten any URL via is.gd — no key required. Returns short URL.',      credits: '1 cr',  icon: '🔗', hot: false },
              { name: 'webhook-send',       desc: 'POST a payload to any external URL — trigger Zapier, n8n, Slack.',     credits: '2 cr',  icon: '⚡', hot: false },
              { name: 'jsonpath-query',     desc: 'Extract values from complex JSON using JSONPath expressions.',          credits: '1 cr',  icon: '⚙', hot: false },
              { name: 'barcode-generate',   desc: 'Generate EAN-13, UPC-A, Code128 barcodes as SVG or PNG.',              credits: '2 cr',  icon: '▌▌▌', hot: false },
              { name: 'agent-balance',      desc: 'GET /v1/agent/balance — agents check credit balance mid-pipeline.',    credits: 'free',  icon: '💳', hot: false },
            ].map((t) => (
              <div
                key={t.name}
                className={`rounded-2xl border p-4 flex flex-col gap-2 hover:bg-white/[0.04] transition-colors ${
                  t.hot ? 'border-indigo-500/30 bg-indigo-500/[0.04]' : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-lg">{t.icon}</span>
                  <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full ${
                    t.credits === 'free'
                      ? 'text-emerald-300/80 bg-emerald-500/10 border border-emerald-500/20'
                      : 'text-indigo-300/80 bg-indigo-500/10 border border-indigo-500/20'
                  }`}>{t.credits}</span>
                </div>
                <div className="font-mono text-xs font-semibold text-white/80">{t.name}</div>
                <div className="text-xs text-white/45 leading-snug">{t.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tool categories ── */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">
              38 tools across 13 categories
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TOOL_CATEGORIES.map(({ cat, tools, icon }) => (
                <div key={cat} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-white/25 text-xs font-mono">{icon}</span>
                    <span className="text-xs font-semibold text-white/75">{cat}</span>
                  </div>
                  <div className="text-xs text-white/35 leading-snug">{tools}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col gap-4">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">
              Get started in 3 steps
            </div>
            <div className="flex flex-col gap-3 flex-1">
              {[
                { n: '01', label: 'Sign up',      sub: 'Magic-link email verification. No credit card required.' },
                { n: '02', label: 'Get API key',  sub: 'Keys are hashed, scoped, and revocable from your dashboard.' },
                { n: '03', label: 'Call 38 tools', sub: '500 free credits to start. Screenshot, image gen, webhooks and more.' },
              ].map(({ n, label, sub }) => (
                <div key={n} className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 flex gap-4 items-start">
                  <span className="font-mono text-xs text-white/20 pt-0.5 shrink-0">{n}</span>
                  <div>
                    <div className="text-sm font-semibold text-white/85">{label}</div>
                    <div className="text-xs text-white/45 mt-0.5 leading-relaxed">{sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <Link
              href="/signin"
              className="block text-center rounded-2xl bg-gradient-to-r from-indigo-500/80 to-cyan-500/80 px-4 py-3 text-sm font-semibold text-white hover:from-indigo-500 hover:to-cyan-500 transition-all"
            >
              Start free — 500 credits included
            </Link>
          </div>
        </div>

        {/* ── SDKs ── */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-white/30 font-mono tracking-widest uppercase">SDKs</p>
            <h2 className="text-xl font-semibold text-white">Python and Node.js SDKs included</h2>
            <p className="text-sm text-white/50">One import, all 38 tools. No per-tool wiring required.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Python */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#3776AB', boxShadow: '0 0 5px #3776AB' }} />
                <span className="text-xs font-semibold text-white/60">Python</span>
                <span className="ml-auto text-[10px] text-white/25 font-mono">pip install archtools</span>
              </div>
              <div className="p-4 font-mono text-xs leading-loose overflow-x-auto">
                <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>from</span><span style={{ color: 'rgba(255,255,255,0.8)' }}> archtools </span><span style={{ color: 'rgba(167,139,250,0.9)' }}>import</span><span style={{ color: 'rgba(255,255,255,0.8)' }}> ArchTools</span></div>
                <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
                <div><span style={{ color: 'rgba(255,255,255,0.5)' }}>at = </span><span style={{ color: 'rgba(103,232,249,0.85)' }}>ArchTools</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>(</span><span style={{ color: 'rgba(103,232,249,0.85)' }}>"at_sk_..."</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>)</span></div>
                <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
                <div><span style={{ color: 'rgba(110,231,183,0.45)' }}># Take a screenshot</span></div>
                <div><span style={{ color: 'rgba(255,255,255,0.6)' }}>shot = at.</span><span style={{ color: 'rgba(103,232,249,0.85)' }}>screenshot_capture</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>(url=</span><span style={{ color: 'rgba(103,232,249,0.85)' }}>"https://example.com"</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>)</span></div>
                <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
                <div><span style={{ color: 'rgba(110,231,183,0.45)' }}># Generate an image</span></div>
                <div><span style={{ color: 'rgba(255,255,255,0.6)' }}>img = at.</span><span style={{ color: 'rgba(103,232,249,0.85)' }}>image_generate</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>(prompt=</span><span style={{ color: 'rgba(103,232,249,0.85)' }}>"neon cityscape"</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>)</span></div>
              </div>
            </div>
            {/* Node.js */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#68A063', boxShadow: '0 0 5px #68A063' }} />
                <span className="text-xs font-semibold text-white/60">Node.js</span>
                <span className="ml-auto text-[10px] text-white/25 font-mono">npm i @archtools/sdk</span>
              </div>
              <div className="p-4 font-mono text-xs leading-loose overflow-x-auto">
                <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>import</span><span style={{ color: 'rgba(255,255,255,0.8)' }}> {'{ ArchTools }'} </span><span style={{ color: 'rgba(167,139,250,0.9)' }}>from</span><span style={{ color: 'rgba(103,232,249,0.85)' }}> '@archtools/sdk'</span></div>
                <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
                <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>const </span><span style={{ color: 'rgba(255,255,255,0.8)' }}>at = </span><span style={{ color: 'rgba(167,139,250,0.9)' }}>new </span><span style={{ color: 'rgba(103,232,249,0.85)' }}>ArchTools</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>('at_sk_...')</span></div>
                <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
                <div><span style={{ color: 'rgba(110,231,183,0.45)' }}>// Shorten a URL</span></div>
                <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>const </span><span style={{ color: 'rgba(255,255,255,0.8)' }}>link = </span><span style={{ color: 'rgba(167,139,250,0.9)' }}>await </span><span style={{ color: 'rgba(255,255,255,0.6)' }}>at.</span><span style={{ color: 'rgba(103,232,249,0.85)' }}>urlShorten</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>({'{ url: '})</span></div>
                <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
                <div><span style={{ color: 'rgba(110,231,183,0.45)' }}>// Send a webhook</span></div>
                <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>await </span><span style={{ color: 'rgba(255,255,255,0.6)' }}>at.</span><span style={{ color: 'rgba(103,232,249,0.85)' }}>webhookSend</span><span style={{ color: 'rgba(255,255,255,0.5)' }}>({'{ url, payload }'})</span></div>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Link href="/docs#sdk-python" className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
              <span style={{ color: '#3776AB' }}>●</span> Python docs →
            </Link>
            <Link href="/docs#sdk-node" className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
              <span style={{ color: '#68A063' }}>●</span> Node.js docs →
            </Link>
          </div>
        </div>

        {/* ── x402 / Agent Economy spotlight ── */}
        <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/8 via-transparent to-indigo-500/8 p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-10">
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300/80 font-semibold mb-4">
                <span style={{ color: '#2775CA' }}>●</span> x402 / USDC · Base L2
              </div>
              <h2 className="text-xl font-semibold text-white leading-snug">
                The first API toolkit an AI agent can pay for without human sign-off.
              </h2>
              <p className="mt-3 text-sm text-white/55 leading-relaxed max-w-lg">
                Arch Tools supports the x402 payment protocol via Coinbase Bazaar. Agents hold a USDC wallet,
                discover the cost of each tool call in the response headers, and pay autonomously in a single
                L2 transaction — no Stripe dashboard, no invoice, no human in the loop.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <div className="text-white/35 mb-0.5">Payment rail</div>
                  <div className="text-white/80 font-mono font-semibold">USDC on Base</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <div className="text-white/35 mb-0.5">Protocol</div>
                  <div className="text-white/80 font-mono font-semibold">x402 / HTTP 402</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                  <div className="text-white/35 mb-0.5">Settlement</div>
                  <div className="text-white/80 font-mono font-semibold">&lt; 2 seconds</div>
                </div>
              </div>
            </div>
            <div className="shrink-0 rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs leading-loose md:w-80">
              <div style={{ color: 'rgba(110,231,183,0.45)' }}>{'// Agent pays for its own tool calls'}</div>
              <div><span style={{ color: 'rgba(103,232,249,0.85)' }}>GET </span><span style={{ color: 'rgba(255,255,255,0.6)' }}>https://archtools.dev/v1/tools/screenshot-capture</span></div>
              <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
              <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>← 402 Payment Required</span></div>
              <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>X-Payment-Required: </span><span style={{ color: 'rgba(103,232,249,0.85)' }}>10 credits</span></div>
              <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>X-Payment-Address: </span><span style={{ color: 'rgba(103,232,249,0.85)' }}>0x1a2b...</span></div>
              <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
              <div><span style={{ color: 'rgba(110,231,183,0.45)' }}>{'// Agent sends USDC, retries:'}</span></div>
              <div><span style={{ color: 'rgba(103,232,249,0.85)' }}>GET </span><span style={{ color: 'rgba(255,255,255,0.6)' }}>...screenshot-capture</span></div>
              <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>X-Payment-Proof: </span><span style={{ color: 'rgba(103,232,249,0.85)' }}>0xabc...</span></div>
              <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
              <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>← 200 OK</span><span style={{ color: 'rgba(255,255,255,0.4)' }}> {'{ image: "data:image/png;..." }'}</span></div>
            </div>
          </div>
        </div>

        {/* ── Free demo tools ── */}
        <div className="flex flex-col gap-3">
          <p className="text-[11px] text-white/30 font-mono tracking-widest uppercase">Try free — no API key</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'QR Code generator →',       href: '/tools/qr-code'         },
              { label: 'Hash generator →',           href: '/tools/hash'            },
              { label: 'Text transform →',           href: '/tools/text-transform'  },
              { label: 'Readability score →',        href: '/tools/readability'     },
              { label: 'UUID generator →',           href: '/tools/uuid'            },
              { label: 'Timezone converter →',       href: '/tools/timezone'        },
            ].map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-white/55 hover:border-white/20 hover:text-white/75 transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Social proof / Testimonials ── */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-white/30 font-mono tracking-widest uppercase">Trusted by developers</p>
            <h2 className="text-xl font-semibold text-white">
              Trusted by developers building with AI
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                quote: 'One API key replaced four separate accounts. My agent calls 12 tools and I manage zero infrastructure.',
                author: 'Senior AI Engineer',
                icon: '🔑',
              },
              {
                quote: 'We went from 3 weeks of API integrations to one afternoon. 53 tools, one POST each.',
                author: 'Startup CTO',
                icon: '⚡',
              },
              {
                quote: 'The x402 payment flow is genius. Our agents buy their own compute. No invoices, no procurement.',
                author: 'Web3 Developer',
                icon: '💎',
              },
              {
                quote: 'I was building a RAG pipeline and needed scraping, summarization, and vector storage. Three API calls. Done.',
                author: 'ML Engineer',
                icon: '🧠',
              },
            ].map((t) => (
              <div
                key={t.author}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 hover:bg-white/[0.05] transition-colors relative overflow-hidden"
              >
                <div
                  className="absolute -top-10 -right-10 w-32 h-32 pointer-events-none"
                  style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)' }}
                  aria-hidden="true"
                />
                <div className="text-2xl mb-4">{t.icon}</div>
                <p className="text-sm text-white/70 leading-relaxed italic mb-4">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="flex items-center gap-2">
                  <div className="h-1 w-6 rounded-full bg-gradient-to-r from-indigo-500/60 to-cyan-500/60" />
                  <span className="text-xs text-white/40 font-medium">{t.author}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CTA banner ── */}
        <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-transparent to-emerald-500/8 p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-base font-semibold text-white">Ready to ship agent features?</div>
              <div className="mt-1 text-sm text-white/55">
                Start free. 500 credits on signup. Scale with pay-as-you-go credit packs or monthly subscriptions.
              </div>
            </div>
            <div className="flex gap-3 shrink-0">
              <Link
                className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors"
                href="/signin"
              >
                Get started free
              </Link>
              <Link
                className="rounded-2xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white/75 hover:border-white/30 hover:text-white transition-colors"
                href="/pricing"
              >
                View pricing
              </Link>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
