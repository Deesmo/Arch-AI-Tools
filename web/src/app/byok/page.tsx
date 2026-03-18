import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'BYOK — Bring Your Own Key | Arch Tools',
  description: 'Use your own API keys with Arch Tools. Pass your OpenAI, Anthropic, xAI, Google, Brave, Tavily, or Firecrawl keys to skip credit charges and use your own LLM credits.',
  keywords: 'BYOK, bring your own key, API keys, OpenAI, Anthropic, Claude, GPT-4, Arch Tools',
}

const BYOK_PROVIDERS = [
  {
    provider: 'Anthropic (Claude)',
    header: 'x-anthropic-key',
    models: 'claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5',
    tools: ['ai-generate', 'ai-oracle', 'summarize', 'sentiment-analysis', 'extract-entities', 'regex-generate', 'pii-detect', 'language-detect', 'research-report', 'fact-check'],
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    color: '#CC785C',
  },
  {
    provider: 'OpenAI (GPT-4o)',
    header: 'x-openai-key',
    models: 'gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo',
    tools: ['ai-generate', 'ai-oracle', 'design-create', 'transcribe-audio'],
    getKeyUrl: 'https://platform.openai.com/api-keys',
    color: '#74AA9C',
  },
  {
    provider: 'xAI (Grok)',
    header: 'x-xai-key',
    models: 'grok-3, grok-3-fast, grok-2',
    tools: ['ai-generate'],
    getKeyUrl: 'https://console.x.ai/',
    color: '#FFFFFF',
  },
  {
    provider: 'Google (Gemini)',
    header: 'x-google-key',
    models: 'gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash',
    tools: ['ai-generate'],
    getKeyUrl: 'https://aistudio.google.com/apikey',
    color: '#4285F4',
  },
  {
    provider: 'Brave Search',
    header: 'x-brave-key',
    models: 'Web search API',
    tools: ['search-web', 'web-search', 'news-search', 'research-report', 'fact-check'],
    getKeyUrl: 'https://brave.com/search/api/',
    color: '#FB542B',
  },
  {
    provider: 'Tavily',
    header: 'x-tavily-key',
    models: 'Search API',
    tools: ['search-web', 'web-search', 'news-search', 'research-report', 'fact-check'],
    getKeyUrl: 'https://tavily.com/',
    color: '#6366F1',
  },
  {
    provider: 'Firecrawl',
    header: 'x-firecrawl-key',
    models: 'Web scraping API',
    tools: ['web-scrape'],
    getKeyUrl: 'https://firecrawl.dev/',
    color: '#FF6B35',
  },
  {
    provider: 'Exa',
    header: 'x-exa-key',
    models: 'Semantic search API',
    tools: ['semantic-search'],
    getKeyUrl: 'https://exa.ai/',
    color: '#22D3EE',
  },
]

export default function ByokPage() {
  return (
    <div className="pt-12 flex flex-col gap-12">
      {/* Hero */}
      <div className="flex flex-col gap-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300/80 font-semibold w-fit">
          <span>🔑</span> Zero credits charged when you use your own keys
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">
          Bring Your Own Key{' '}
          <span className="text-white/40">(BYOK)</span>
        </h1>
        <p className="max-w-2xl text-lg text-white/60 leading-relaxed">
          Already paying for OpenAI, Anthropic, or other AI providers? Pass your own API key as a header —
          Arch Tools will use your key instead of ours and <strong className="text-white/80">won&apos;t deduct any credits</strong>.
        </p>
      </div>

      {/* How it works */}
      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { step: '01', title: 'Add a header', desc: 'Include your provider API key as an HTTP header alongside your Arch Tools API key.' },
            { step: '02', title: 'We route to your key', desc: 'Arch Tools calls the provider API using YOUR key. We never store it — it\'s used for that single request.' },
            { step: '03', title: 'Zero credits charged', desc: 'When BYOK is detected, we skip credit deduction entirely. You pay the provider directly.' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <span className="font-mono text-xs text-white/20">{step}</span>
              <div className="text-sm font-semibold text-white mt-2">{title}</div>
              <div className="text-sm text-white/50 mt-1 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Code example */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Quick example</h2>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
            <span className="ml-2 text-xs text-white/30 font-mono">byok-example.sh</span>
          </div>
          <div className="p-5 font-mono text-xs leading-loose overflow-x-auto">
            <div style={{ color: 'rgba(110,231,183,0.45)' }}># Use your own Anthropic key — zero Arch Tools credits charged</div>
            <div>
              <span style={{ color: 'rgba(167,139,250,0.9)' }}>curl</span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}> -X POST https://archtools.dev/v1/tools/ai-generate \</span>
            </div>
            <div>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>  -H </span>
              <span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;Authorization: Bearer at_sk_YOUR_ARCH_KEY&quot;</span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}> \</span>
            </div>
            <div>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>  -H </span>
              <span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;x-anthropic-key: sk-ant-YOUR_KEY_HERE&quot;</span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}> \</span>
            </div>
            <div>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>  -H </span>
              <span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;Content-Type: application/json&quot;</span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}> \</span>
            </div>
            <div>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>  -d </span>
              <span style={{ color: 'rgba(103,232,249,0.85)' }}>{`'{"prompt": "Explain quantum computing", "model": "claude-sonnet-4-6"}'`}</span>
            </div>
            <div style={{ color: 'rgba(110,231,183,0.45)', marginTop: '12px' }}># Response includes byok: true confirming your key was used</div>
            <div style={{ color: 'rgba(110,231,183,0.45)' }}># Credits charged: 0</div>
          </div>
        </div>
      </div>

      {/* Supported providers */}
      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold">Supported providers &amp; headers</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {BYOK_PROVIDERS.map(({ provider, header, models, tools, getKeyUrl, color }) => (
            <div key={header} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:bg-white/[0.05] transition-colors">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 5px ${color}` }} />
                <span className="text-sm font-semibold text-white/85">{provider}</span>
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-white/40">Header: </span>
                  <code className="text-cyan-300/80 font-mono bg-white/[0.05] px-1.5 py-0.5 rounded">{header}</code>
                </div>
                <div>
                  <span className="text-white/40">Models: </span>
                  <span className="text-white/60">{models}</span>
                </div>
                <div>
                  <span className="text-white/40">Tools: </span>
                  <span className="text-white/60">{tools.join(', ')}</span>
                </div>
                <a
                  href={getKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-indigo-300/70 hover:text-indigo-300 transition-colors mt-1"
                >
                  Get API key → 
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SDK examples */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">SDK usage</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#3776AB' }} />
              <span className="text-xs font-semibold text-white/60">Python</span>
            </div>
            <div className="p-4 font-mono text-xs leading-loose">
              <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>from</span> archtools <span style={{ color: 'rgba(167,139,250,0.9)' }}>import</span> ArchTools</div>
              <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
              <div>at = ArchTools(<span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;at_sk_...&quot;</span>)</div>
              <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
              <div style={{ color: 'rgba(110,231,183,0.45)' }}># Pass your own Anthropic key</div>
              <div>result = at.ai_generate(</div>
              <div>  prompt=<span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;Hello world&quot;</span>,</div>
              <div>  headers={'{'}
                <span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;x-anthropic-key&quot;</span>: <span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;sk-ant-...&quot;</span>
              {'}'}</div>
              <div>)</div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#68A063' }} />
              <span className="text-xs font-semibold text-white/60">Node.js</span>
            </div>
            <div className="p-4 font-mono text-xs leading-loose">
              <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>import</span> {'{ ArchTools }'} <span style={{ color: 'rgba(167,139,250,0.9)' }}>from</span> <span style={{ color: 'rgba(103,232,249,0.85)' }}>&apos;@archtools/sdk&apos;</span></div>
              <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
              <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>const</span> at = <span style={{ color: 'rgba(167,139,250,0.9)' }}>new</span> ArchTools(<span style={{ color: 'rgba(103,232,249,0.85)' }}>&apos;at_sk_...&apos;</span>)</div>
              <div style={{ color: 'rgba(110,231,183,0.45)' }}></div>
              <div style={{ color: 'rgba(110,231,183,0.45)' }}>// Pass your own OpenAI key</div>
              <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>const</span> result = <span style={{ color: 'rgba(167,139,250,0.9)' }}>await</span> at.aiGenerate({'{'}</div>
              <div>  prompt: <span style={{ color: 'rgba(103,232,249,0.85)' }}>&apos;Hello world&apos;</span>,</div>
              <div>  model: <span style={{ color: 'rgba(103,232,249,0.85)' }}>&apos;gpt-4o&apos;</span>,</div>
              <div>{'}'}, {'{'} headers: {'{'} <span style={{ color: 'rgba(103,232,249,0.85)' }}>&apos;x-openai-key&apos;</span>: <span style={{ color: 'rgba(103,232,249,0.85)' }}>&apos;sk-...&apos;</span> {'}'} {'}'})</div>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold">FAQ</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { q: 'Do you store my API key?', a: 'No. Your key is used for a single request and never persisted. It\'s transmitted over HTTPS and discarded after the API call completes.' },
            { q: 'Do I still need an Arch Tools API key?', a: 'Yes. Your Arch Tools key handles authentication and rate limiting. The BYOK header is an additional parameter that tells us to use your provider key instead of ours.' },
            { q: 'What if my BYOK key is invalid?', a: 'You\'ll receive the provider\'s error message directly. We pass through errors from the upstream provider so you can debug.' },
            { q: 'Can I mix BYOK and credits?', a: 'Yes. BYOK is per-request. You can use your own key for ai-generate calls and credits for web-scrape calls in the same session.' },
            { q: 'Does BYOK work with MCP?', a: 'Yes. MCP tool calls pass through the same HTTP API, so you can include BYOK headers in your MCP client configuration.' },
            { q: 'Which tools support BYOK?', a: 'All AI-powered tools (ai-generate, ai-oracle, summarize, etc.), search tools (search-web, news-search), and web-scrape (via Firecrawl). See the full table above.' },
          ].map(({ q, a }) => (
            <div key={q} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-sm font-semibold text-white/85 mb-2">{q}</div>
              <div className="text-sm text-white/50 leading-relaxed">{a}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/8 via-transparent to-indigo-500/8 p-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-base font-semibold text-white">Ready to use your own keys?</div>
          <div className="mt-1 text-sm text-white/55">
            Sign up for free, grab an API key, and add your provider key as a header. That&apos;s it.
          </div>
        </div>
        <div className="flex gap-3 shrink-0">
          <Link
            className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors"
            href="/signin"
          >
            Get API key free
          </Link>
          <Link
            className="rounded-2xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white/75 hover:border-white/30 hover:text-white transition-colors"
            href="/docs"
          >
            Read the docs
          </Link>
        </div>
      </div>
    </div>
  )
}
