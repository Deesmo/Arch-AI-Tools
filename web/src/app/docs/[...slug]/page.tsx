import Link from 'next/link'

type DocPage = {
  title: string
  sections: { heading?: string; body: string; code?: string; lang?: string }[]
}

const PAGES: Record<string, DocPage> = {
  quickstart: {
    title: 'Quickstart',
    sections: [
      {
        heading: '1. Sign up',
        body: 'Go to archtools.dev/signin and enter your email. You\'ll receive a magic link — click it to verify and receive your API key. It\'s shown once, so save it somewhere safe.',
      },
      {
        heading: '2. Make your first tool call',
        body: 'Use the API key in the Authorization header. Here\'s a complete example calling the ip-lookup tool:',
        code: `curl -X POST https://archtools.dev/v1/tools/ip-lookup \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "ip": "8.8.8.8" }'`,
        lang: 'bash',
      },
      {
        heading: 'Response shape',
        body: 'Every tool returns a consistent envelope:',
        code: `{
  "tool": "ip-lookup",
  "request_id": "uuid",
  "credits_used": 2,
  "credits_remaining": 98,
  "latency_ms": 142,
  "cache_hit": false,
  "result": {
    "ok": true,
    "ip": "8.8.8.8",
    "country": "United States",
    "city": "Mountain View",
    "isp": "Google LLC"
  }
}`,
        lang: 'json',
      },
      {
        heading: '3. Node.js SDK (optional)',
        body: 'Install the SDK for cleaner integration:',
        code: `npm install archtools

import { ArchTools } from 'archtools'

const arch = new ArchTools(process.env.ARCH_API_KEY)
const result = await arch.tools.run('sentiment-analysis', {
  text: 'Arch Tools is incredible!'
})
console.log(result.sentiment) // "positive"`,
        lang: 'js',
      },
      {
        heading: '4. Python SDK (optional)',
        body: '',
        code: `pip install archtools

from archtools import ArchTools

arch = ArchTools(api_key="YOUR_API_KEY")
result = arch.tools.run("ip-lookup", {"ip": "8.8.8.8"})
print(result["result"]["country"])`,
        lang: 'python',
      },
    ],
  },

  tools: {
    title: 'Tools reference',
    sections: [
      {
        body: 'All tools run through a unified endpoint. Discover available tools without authentication:',
        code: `GET https://archtools.dev/v1/tools`,
        lang: 'bash',
      },
      {
        heading: 'Call a tool',
        body: 'POST to /v1/tools/:toolName with a JSON body. Authentication required.',
        code: `POST /v1/tools/sentiment-analysis
Authorization: Bearer YOUR_KEY
Content-Type: application/json

{ "text": "This API is absolutely fantastic!" }`,
        lang: 'bash',
      },
      {
        heading: 'Semantic search',
        body: 'Find tools by task description — useful for agents discovering capabilities:',
        code: `POST /v1/tools/search
{ "task": "detect language of text", "limit": 5 }`,
        lang: 'bash',
      },
      {
        heading: 'Tool categories',
        body: `Data     — validate-data, convert-format, diff-text, generate-hash
Text     — transform-text, summarize, readability-score
AI       — ai-generate, ocr-extract, extract-entities, sentiment-analysis, pii-detect
Web      — web-scrape, search-web, web-search, extract-page, rss-parse, extract-metadata
Browser  — browser-task (Playwright)
Network  — ip-lookup, whois-lookup, email-verify, phone-validate
Finance  — currency-convert
Utility  — timezone-convert, generate-uuid, regex-generate, qr-code, extract-pdf`,
      },
    ],
  },

  workflows: {
    title: 'Workflow engine',
    sections: [
      {
        body: 'Run up to 8 tools sequentially in a single API call. Steps execute in order, and each step can reference the previous step\'s output using $last.',
      },
      {
        heading: 'Basic workflow',
        code: `POST /v1/workflows/run
Authorization: Bearer YOUR_KEY

{
  "steps": [
    { "tool": "web-scrape",  "input": { "url": "https://techcrunch.com" } },
    { "tool": "summarize",   "input": { "text": "$last", "style": "bullets" } },
    { "tool": "pii-detect",  "input": { "text": "$last", "redact": true } }
  ]
}`,
        lang: 'json',
      },
      {
        heading: 'Response',
        body: 'The workflow response includes per-step outputs, total credits used, and overall latency:',
        code: `{
  "workflow_id": "uuid",
  "steps": [
    { "step": 1, "tool": "web-scrape",  "credits": 5, "latency_ms": 820, "result": {...} },
    { "step": 2, "tool": "summarize",   "credits": 10,"latency_ms": 340, "result": {...} },
    { "step": 3, "tool": "pii-detect",  "credits": 10,"latency_ms": 210, "result": {...} }
  ],
  "credits_used": 25,
  "credits_remaining": 75,
  "latency_ms": 1370
}`,
        lang: 'json',
      },
      {
        heading: '$last templating',
        body: '$last is replaced with the string representation of the prior step\'s result. For nested access, pass the full prior result and use ai-generate to extract fields.',
      },
    ],
  },

  agent: {
    title: 'Agent runtime',
    sections: [
      {
        body: 'Submit a natural language task. The runtime plans a bounded workflow of up to 5 steps and executes it with automatic credit billing.',
      },
      {
        heading: 'Execute a task',
        code: `POST /v1/agent/execute
Authorization: Bearer YOUR_KEY

{
  "task": "Find the latest news about Nvidia and write a 3-bullet summary"
}`,
        lang: 'json',
      },
      {
        heading: 'Response',
        code: `{
  "request_id": "uuid",
  "task": "Find the latest news about Nvidia...",
  "plan": ["search-web", "summarize"],
  "steps": [...],
  "result": "• Nvidia reported record Q3 revenue...\n• ...",
  "credits_used": 15,
  "credits_remaining": 85
}`,
        lang: 'json',
      },
      {
        heading: 'When to use the agent vs. workflows',
        body: `Use workflows when:
- You know the exact tools and order needed
- You need deterministic, repeatable execution
- You want predictable credit costs

Use the agent when:
- The task is open-ended
- You want the system to choose tools automatically
- Flexibility matters more than determinism`,
      },
    ],
  },

  'browser-automation': {
    title: 'Browser automation',
    sections: [
      {
        body: 'The browser-task tool uses Playwright to control a headless Chromium instance. Supports extract, click, type, and html actions.',
      },
      {
        heading: 'Extract text with a CSS selector',
        code: `POST /v1/tools/browser-task
{
  "url": "https://news.ycombinator.com",
  "action": "extract",
  "selector": ".titleline"
}`,
        lang: 'json',
      },
      {
        heading: 'Get full page HTML',
        code: `{
  "url": "https://example.com",
  "action": "html"
}`,
        lang: 'json',
      },
      {
        heading: 'Click a button',
        code: `{
  "url": "https://example.com/login",
  "action": "click",
  "selector": "#submit-btn"
}`,
        lang: 'json',
      },
      {
        heading: 'Type into a field',
        code: `{
  "url": "https://example.com/search",
  "action": "type",
  "selector": "input[name=q]",
  "text": "Arch Tools"
}`,
        lang: 'json',
      },
      {
        heading: 'Security',
        body: 'All requests are SSRF-hardened: private IP ranges, cloud metadata endpoints (169.254.169.254), and localhost are blocked. Results are bounded to 50,000 characters.',
      },
    ],
  },
}

export default async function DocPage({ params }: { params: { slug: string[] } }) {
  const key = (params.slug || []).join('/').split('/')[0]
  const page = PAGES[key]

  if (!page) {
    return (
      <div className="pt-14">
        <Link className="text-sm text-white/50 hover:text-white mb-6 inline-block" href="/docs">← Docs</Link>
        <h1 className="text-3xl font-semibold">Page not found</h1>
        <p className="mt-3 text-white/55">That doc page doesn't exist yet.</p>
      </div>
    )
  }

  return (
    <div className="pt-14 max-w-3xl">
      <Link className="text-sm text-white/45 hover:text-white/80 transition-colors mb-8 inline-block" href="/docs">← Docs</Link>
      <h1 className="text-4xl font-semibold tracking-tight mb-10">{page.title}</h1>

      <div className="flex flex-col gap-8">
        {page.sections.map((s, i) => (
          <div key={i}>
            {s.heading && (
              <h2 className="text-base font-semibold text-white mb-3">{s.heading}</h2>
            )}
            {s.body && (
              <p className="text-sm text-white/55 leading-relaxed whitespace-pre-line mb-3">{s.body}</p>
            )}
            {s.code && (
              <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
                {s.lang && (
                  <div className="border-b border-white/8 px-4 py-1.5 text-xs text-white/25 font-mono">{s.lang}</div>
                )}
                <pre className="overflow-auto p-4 text-xs text-white/75 leading-relaxed font-mono">{s.code}</pre>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border border-white/10 bg-white/[0.02] p-5 flex items-center justify-between gap-4">
        <div className="text-sm text-white/45">Ready to try it?</div>
        <div className="flex gap-2">
          <Link href="/playground" className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/65 hover:border-white/30 hover:text-white transition-colors">Playground</Link>
          <Link href="/signin" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors">Get API key</Link>
        </div>
      </div>
    </div>
  )
}
