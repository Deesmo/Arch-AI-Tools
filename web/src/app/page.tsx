import Link from 'next/link'

const TOOL_CATEGORIES = [
  { cat: 'Data',      tools: 'validate · convert · diff',          icon: '⬡' },
  { cat: 'Text',      tools: 'transform · summarize · readability', icon: '≋' },
  { cat: 'AI',        tools: 'generate · OCR · NER · sentiment',   icon: '◈' },
  { cat: 'Web',       tools: 'scrape · search · RSS · extract',    icon: '⊕' },
  { cat: 'Browser',   tools: 'Playwright automation',              icon: '⊞' },
  { cat: 'Security',  tools: 'hash · PII detect',                  icon: '⊛' },
  { cat: 'Network',   tools: 'IP lookup · WHOIS',                  icon: '⊗' },
  { cat: 'Validate',  tools: 'email · phone',                      icon: '✓' },
  { cat: 'Finance',   tools: 'currency convert',                   icon: '$' },
  { cat: 'Utilities', tools: 'UUID · timezone · QR',               icon: '⊜' },
]

function CodeBlock() {
  const singleTool = `// Single tool call
const res = await fetch('https://archtools.dev/v1/tools/sentiment-analysis', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer YOUR_KEY', 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Arch Tools is incredible!' })
})
// → { sentiment: "positive", score: 0.97, emotions: {...} }`

  const workflow = `// Multi-step workflow — $last passes prior output
await fetch('/v1/workflows/run', {
  body: JSON.stringify({ steps: [
    { tool: 'web-scrape', input: { url: 'https://techcrunch.com' } },
    { tool: 'summarize',  input: { text: '$last', style: 'bullets' } },
    { tool: 'pii-detect', input: { text: '$last', redact: true } },
  ]})
})`

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
      <div className="flex items-center gap-1.5 px-1 pb-1">
        <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
        <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
        <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
        <span className="ml-2 text-xs text-white/30 font-mono">arch-tools-demo.ts</span>
      </div>
      <pre className="overflow-auto rounded-xl bg-black/50 p-4 text-xs leading-relaxed text-white/75"><code>{singleTool}</code></pre>
      <pre className="overflow-auto rounded-xl bg-black/50 p-4 text-xs leading-relaxed text-white/75"><code>{workflow}</code></pre>
      <div className="flex items-center justify-between text-xs text-white/40 px-1 pt-1">
        <div className="flex items-center gap-3">
          <span className="text-emerald-400/70">30 tools</span>
          <span>·</span>
          <span>workflow engine</span>
          <span>·</span>
          <span>MCP</span>
          <span>·</span>
          <span>x402 / USDC</span>
        </div>
        <Link className="text-white/60 hover:text-white transition-colors" href="/docs">Open docs →</Link>
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/65">
      {children}
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="pt-12">
      <div className="flex flex-col gap-12">

        {/* Hero */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-2">
            <Pill>30 production tools</Pill>
            <Pill>Workflow engine</Pill>
            <Pill>MCP compatible</Pill>
            <Pill>x402 / USDC</Pill>
            <Pill>Browser automation</Pill>
          </div>

          <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-6xl">
            Infrastructure for{' '}
            <span className="bg-gradient-to-r from-indigo-300 via-cyan-200 to-emerald-300 bg-clip-text text-transparent">
              AI agents.
            </span>
          </h1>

          <p className="max-w-2xl text-pretty text-lg text-white/65 leading-relaxed">
            30 production-ready APIs that agents can discover, execute, and pay for — with
            authentication, credit billing, rate limiting, multi-step workflows, and browser
            automation built in.
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
          </div>

          {/* Stats strip */}
          <div className="flex flex-wrap gap-8 pt-4 border-t border-white/8">
            {[
              { value: '30', label: 'production tools' },
              { value: '100', label: 'free credits on signup' },
              { value: '$0.001', label: 'cheapest tool call' },
              { value: 'MCP', label: 'agent protocol' },
            ].map(({ value, label }) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-xl font-bold tracking-tight text-white">{value}</span>
                <span className="text-xs text-white/40">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Code block */}
        <CodeBlock />

        {/* Features */}
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: 'Trustworthy by design',
              desc: 'Hashed API keys, SSRF-hardened scraping, disposable email blocking, Cloudflare Turnstile CAPTCHA, rate limits, and Sentry error tracking.',
              icon: '🔐',
            },
            {
              title: 'Built for agents',
              desc: 'Tool discovery via /v1/tools, multi-step workflow runner with $last chaining, MCP server, and x402 USDC payments — agents self-fund.',
              icon: '🤖',
            },
            {
              title: 'Developer-first',
              desc: 'Interactive playground, OpenAPI spec, Postman collection, Python + Node SDKs, magic-link signup. No card required to start.',
              icon: '⚡',
            },
          ].map((x) => (
            <div key={x.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 hover:bg-white/[0.05] transition-colors">
              <div className="text-2xl mb-3">{x.icon}</div>
              <div className="text-sm font-semibold text-white">{x.title}</div>
              <div className="mt-2 text-sm text-white/55 leading-relaxed">{x.desc}</div>
            </div>
          ))}
        </div>

        {/* Tool categories + onboarding */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Tool categories</div>
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
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">Get started in 3 steps</div>
            <div className="flex flex-col gap-3 flex-1">
              {[
                { n: '01', label: 'Sign up', sub: 'Magic-link email verification. No credit card required.' },
                { n: '02', label: 'Get API key', sub: 'Keys are hashed, scoped, and revocable from your dashboard.' },
                { n: '03', label: 'Call tools', sub: 'Credits debit automatically. 100 free credits to start.' },
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
              Start free — 100 credits included
            </Link>
          </div>
        </div>

        {/* CTA banner */}
        <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-transparent to-emerald-500/8 p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-base font-semibold text-white">Ready to ship agent features?</div>
              <div className="mt-1 text-sm text-white/55">Start free. 100 credits on signup. Scale with pay-as-you-go credit packs.</div>
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
