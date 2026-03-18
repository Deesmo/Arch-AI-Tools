'use client'

import { useState } from 'react'
import Link from 'next/link'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="absolute right-3 top-3 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/50 hover:border-white/25 hover:text-white/80 transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function CodeBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  return (
    <div className="relative mt-3 rounded-xl border border-white/8 bg-black/50 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2">
        <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{lang}</span>
      </div>
      <CopyButton text={code} />
      <pre className="overflow-x-auto px-4 py-3 text-xs font-mono text-white/70 leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

function Section({ id, number, title, children }: { id: string; number: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-indigo-500/25 text-xs font-bold text-indigo-300">
          {number}
        </span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="ml-10 text-sm text-white/55 leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  )
}

const STEPS = [
  { id: 'api-key', label: 'Get Your API Key' },
  { id: 'first-call', label: 'Make Your First Call' },
  { id: 'ai-generate', label: 'Try AI Generation' },
  { id: 'oracle', label: 'Use the Oracle' },
  { id: 'mcp', label: 'Connect via MCP' },
  { id: 'sdk', label: 'Install the SDK' },
  { id: 'pipeline', label: 'Build a Pipeline' },
]

export default function GettingStartedPage() {
  return (
    <div className="pt-12">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <Link href="/docs" className="text-xs text-white/35 hover:text-white/60 transition-colors">
            Docs
          </Link>
          <span className="text-xs text-white/20">→</span>
          <span className="text-xs text-white/55">Getting Started</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Getting Started</h1>
        <p className="mt-3 max-w-2xl text-white/55 leading-relaxed">
          Go from zero to your first AI-powered tool call in under 5 minutes.
          Follow each step below, or jump to what you need.
        </p>
      </div>

      {/* Table of contents */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-10">
        <div className="text-xs font-semibold text-white/35 uppercase tracking-widest mb-3">In this guide</div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-lg px-3 py-2 text-sm text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors flex items-center gap-2.5"
            >
              <span className="text-[10px] font-bold text-indigo-400/70">{i + 1}</span>
              {s.label}
            </a>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-12">
        {/* 1. Get Your API Key */}
        <Section id="api-key" number={1} title="Get Your API Key">
          <p>
            Sign up at{' '}
            <Link href="/signin" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-400/30">
              archtools.dev/signin
            </Link>{' '}
            to create your account. Every new account gets <strong className="text-white/80">100 free credits</strong> — enough for dozens of tool calls.
          </p>
          <p>
            After signing in, your API key is on the{' '}
            <Link href="/dashboard" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-400/30">
              Dashboard
            </Link>.
            It starts with <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs font-mono text-white/65">arch_</code>.
          </p>
          <CodeBlock
            lang="bash"
            code={`# Save your key as an environment variable
export ARCH_API_KEY="arch_your_key_here"`}
          />
        </Section>

        {/* 2. Make Your First Call */}
        <Section id="first-call" number={2} title="Make Your First Call">
          <p>
            The <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs font-mono text-white/65">search-web</code> tool searches the web and returns structured results.
            5 credits per call.
          </p>
          <CodeBlock
            lang="bash"
            code={`curl -X POST https://archtools.dev/v1/tools/search-web \\
  -H "Authorization: Bearer $ARCH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "latest AI news", "num_results": 3}'`}
          />
          <p>
            You&apos;ll get back a JSON response with <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs font-mono text-white/65">results</code> containing titles, URLs, and snippets.
          </p>
        </Section>

        {/* 3. Try AI Generation */}
        <Section id="ai-generate" number={3} title="Try AI Generation">
          <p>
            The <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs font-mono text-white/65">ai-generate</code> tool wraps Claude, GPT-4o, Gemini, and Grok behind a single endpoint.
            Use <strong className="text-white/80">mode presets</strong> for easy model selection:
          </p>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 my-3">
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="text-center">
                <div className="text-emerald-400 font-semibold mb-1">⚡ fast</div>
                <div className="text-white/40">Haiku · cheapest</div>
              </div>
              <div className="text-center">
                <div className="text-indigo-400 font-semibold mb-1">🧠 smart</div>
                <div className="text-white/40">Sonnet · balanced</div>
              </div>
              <div className="text-center">
                <div className="text-violet-400 font-semibold mb-1">🔮 deep</div>
                <div className="text-white/40">Opus · most capable</div>
              </div>
            </div>
          </div>
          <CodeBlock
            lang="bash"
            code={`curl -X POST https://archtools.dev/v1/tools/ai-generate \\
  -H "Authorization: Bearer $ARCH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Explain quantum computing in 3 sentences",
    "mode": "smart",
    "max_tokens": 200
  }'`}
          />
        </Section>

        {/* 4. Use the Oracle */}
        <Section id="oracle" number={4} title="Use the Oracle">
          <p>
            For complex reasoning — analysis, strategy, multi-step logic — use the{' '}
            <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs font-mono text-white/65">ai-oracle</code> endpoint.
            It tries Opus first, then GPT-4o as fallback, and returns structured analysis with confidence levels.
          </p>
          <CodeBlock
            lang="bash"
            code={`curl -X POST https://archtools.dev/v1/tools/ai-oracle \\
  -H "Authorization: Bearer $ARCH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "question": "Should a SaaS startup prioritize SEO or paid ads in year one?",
    "reasoning_depth": "deep"
  }'`}
          />
          <p>
            Returns <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs font-mono text-white/65">analysis</code>,{' '}
            <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs font-mono text-white/65">confidence</code>, and{' '}
            <code className="rounded bg-white/8 px-1.5 py-0.5 text-xs font-mono text-white/65">model_used</code>.
            25 credits per call.
          </p>
        </Section>

        {/* 5. Connect via MCP */}
        <Section id="mcp" number={5} title="Connect via MCP">
          <p>
            Add Arch Tools to <strong className="text-white/80">Claude Desktop</strong>, <strong className="text-white/80">Cursor</strong>, or{' '}
            <strong className="text-white/80">Windsurf</strong> as an MCP server. Paste this into your config:
          </p>
          <CodeBlock
            lang="json"
            code={`{
  "mcpServers": {
    "archtools": {
      "url": "https://arch-tools-mcp.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
          />
          <p>
            All 30+ tools become available as native MCP tools inside your AI editor.
          </p>
        </Section>

        {/* 6. Install the SDK */}
        <Section id="sdk" number={6} title="Install the SDK">
          <p>
            Use the official SDK for typed, ergonomic access to every tool.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-white/40 mb-1">Node.js / TypeScript</div>
              <CodeBlock lang="bash" code="npm install @archtools/sdk" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white/40 mb-1">Python</div>
              <CodeBlock lang="bash" code="pip install archtools" />
            </div>
          </div>
          <CodeBlock
            lang="typescript"
            code={`import { ArchTools } from '@archtools/sdk'

const arch = new ArchTools({ apiKey: process.env.ARCH_API_KEY! })
const result = await arch.searchWeb({ query: 'AI news' })
console.log(result)`}
          />
          <CodeBlock
            lang="python"
            code={`from archtools import ArchTools

arch = ArchTools(api_key="arch_your_key_here")
result = arch.search_web(query="AI news")
print(result)`}
          />
        </Section>

        {/* 7. Build a Pipeline */}
        <Section id="pipeline" number={7} title="Build a Pipeline">
          <p>
            Chain tools together to build powerful workflows. Here&apos;s a 3-step pipeline:
            scrape a page → summarize the content → store it in a vector namespace.
          </p>
          <CodeBlock
            lang="bash"
            code={`# Step 1: Scrape a web page
curl -s -X POST https://archtools.dev/v1/tools/web-scrape \\
  -H "Authorization: Bearer $ARCH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/article"}' > /tmp/scraped.json

# Step 2: Summarize the content
CONTENT=$(jq -r '.text' /tmp/scraped.json)
curl -s -X POST https://archtools.dev/v1/tools/summarize \\
  -H "Authorization: Bearer $ARCH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{\"text\": \"$CONTENT\", \"style\": \"bullets\"}" > /tmp/summary.json

# Step 3: Store in vector namespace for later retrieval
SUMMARY=$(jq -r '.summary' /tmp/summary.json)
curl -s -X POST https://archtools.dev/v1/tools/vector-store \\
  -H "Authorization: Bearer $ARCH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{\"content\": \"$SUMMARY\", \"namespace\": \"research\"}"
`}
          />
          <p>
            Or do it in one call with the SDK:
          </p>
          <CodeBlock
            lang="typescript"
            code={`import { ArchTools } from '@archtools/sdk'

const arch = new ArchTools({ apiKey: process.env.ARCH_API_KEY! })

// Scrape → Summarize → Store
const page = await arch.webScrape({ url: 'https://example.com/article' })
const summary = await arch.summarize({ text: page.text, style: 'bullets' })
await arch.vectorStore({
  content: summary.summary,
  namespace: 'research',
  metadata: { source: 'https://example.com/article' }
})`}
          />
        </Section>
      </div>

      {/* Next steps */}
      <div className="mt-16 rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/5 to-emerald-500/5 p-6">
        <h3 className="text-sm font-semibold mb-3">What&apos;s next?</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Link href="/docs" className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/55 hover:border-white/20 hover:text-white/80 transition-colors">
            📖 Full API reference
          </Link>
          <Link href="/playground" className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/55 hover:border-white/20 hover:text-white/80 transition-colors">
            🧪 Interactive playground
          </Link>
          <Link href="/pricing" className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/55 hover:border-white/20 hover:text-white/80 transition-colors">
            💳 Pricing & plans
          </Link>
        </div>
      </div>
    </div>
  )
}
