'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api'

const TOOLS = [
  { name: 'validate-data',      default: { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, data: { name: 'Brad' } } },
  { name: 'generate-hash',      default: { input: 'hello world', algorithm: 'sha256' } },
  { name: 'qr-code',            default: { text: 'https://archtools.dev', format: 'dataurl' } },
  { name: 'convert-format',     default: { from: 'json', to: 'yaml', data: { name: 'Arch Tools', version: '11' } } },
  { name: 'transform-text',     default: { text: 'Hello World from Arch Tools', mode: 'slug' } },
  { name: 'extract-metadata',   default: { url: 'https://archtools.dev' } },
  { name: 'web-scrape',         default: { url: 'https://example.com', format: 'text' } },
  { name: 'ai-generate',        default: { prompt: 'Write a one-sentence pitch for Arch Tools API.', model: 'claude-haiku-4-5-20251001' } },
  { name: 'search-web',         default: { query: 'latest AI agent frameworks 2025', limit: 5 } },
  { name: 'extract-page',       default: { url: 'https://example.com' } },
  { name: 'browser-task',       default: { url: 'https://news.ycombinator.com', action: 'extract', selector: '.titleline' } },
  { name: 'ocr-extract',        default: { image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Fondue_de_fromage.jpg/800px-Fondue_de_fromage.jpg' } },
  { name: 'ip-lookup',          default: { ip: '8.8.8.8' } },
  { name: 'email-verify',       default: { email: 'test@gmail.com' } },
  { name: 'phone-validate',     default: { phone: '+1 (212) 555-0100', country_code: 'US' } },
  { name: 'currency-convert',   default: { amount: 100, from: 'USD', to: 'EUR' } },
  { name: 'timezone-convert',   default: { datetime: '2025-06-01T12:00:00Z', from_tz: 'America/New_York', to_tz: 'Asia/Tokyo' } },
  { name: 'web-search',         default: { query: 'Arch Tools API agent', max_results: 5, include_answer: true } },
  { name: 'sentiment-analysis', default: { text: 'Arch Tools is absolutely incredible! Best API I have ever used.' } },
  { name: 'summarize',          default: { text: 'Arch Tools provides 30 production-ready API tools for developers and AI agents, with authentication, billing, rate limiting, and a workflow engine built in.', style: 'tldr' } },
  { name: 'extract-entities',   default: { text: 'Brad Valdes founded Arch Enterprises LLC in Columbia, South Carolina in 2024.' } },
  { name: 'language-detect',    default: { text: 'Bonjour, comment allez-vous aujourd\'hui?' } },
  { name: 'pii-detect',         default: { text: 'Contact John Smith at john@example.com or 555-123-4567.', redact: true } },
  { name: 'readability-score',  default: { text: 'Arch Tools provides a comprehensive API platform for developers building AI agents and automation workflows.' } },
  { name: 'rss-parse',          default: { url: 'https://feeds.arstechnica.com/arstechnica/index', limit: 5 } },
  { name: 'generate-uuid',      default: { type: 'v4', count: 3 } },
  { name: 'regex-generate',     default: { description: 'Match a valid US phone number', test_strings: ['555-123-4567', '(800) 555-0100', 'not-a-phone'] } },
  { name: 'diff-text',          default: { original: 'The quick brown fox', modified: 'The quick red fox jumps', format: 'json' } },
  { name: 'whois-lookup',       default: { domain: 'archtools.dev' } },
]

export default function PlaygroundPage() {
  const [apiKey, setApiKey] = useState('')
  const [mode, setMode] = useState<'tool' | 'workflow'>('tool')
  const [tool, setTool] = useState('ip-lookup')
  const [input, setInput] = useState(JSON.stringify({ ip: '8.8.8.8' }, null, 2))
  const [workflowSteps, setWorkflowSteps] = useState(JSON.stringify([
    { tool: 'web-scrape', input: { url: 'https://example.com' } },
    { tool: 'summarize', input: { text: '$last', style: 'tldr' } },
  ], null, 2))
  const [out, setOut] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function loadPreset(name: string) {
    setTool(name)
    const found = TOOLS.find(t => t.name === name)
    setInput(JSON.stringify(found?.default || {}, null, 2))
    setErr(null)
    setOut(null)
  }

  async function run() {
    setBusy(true); setErr(null); setOut(null)
    try {
      if (!apiKey.trim()) throw new Error('Paste your API key above to run a request')
      if (mode === 'tool') {
        const body = JSON.parse(input || '{}')
        const res = await apiFetch(`/v1/tools/${tool}`, { method: 'POST', body: JSON.stringify(body), apiKey })
        setOut(res)
      } else {
        const steps = JSON.parse(workflowSteps || '[]')
        const res = await apiFetch('/v1/workflows/run', { method: 'POST', body: JSON.stringify({ steps }), apiKey })
        setOut(res)
      }
    } catch (e: any) {
      setErr(e?.data?.detail || e?.message || 'Request failed')
      setOut(e?.data || null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-14">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Playground</h1>
          <p className="mt-2 text-white/55">
            Test all {TOOLS.length} tools and multi-step workflows with your API key.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setMode('tool'); setErr(null); setOut(null) }}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${mode === 'tool' ? 'bg-white text-[#070812]' : 'border border-white/15 text-white/60 hover:border-white/30 hover:text-white'}`}
          >
            Tool
          </button>
          <button
            onClick={() => { setMode('workflow'); setErr(null); setOut(null) }}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${mode === 'workflow' ? 'bg-white text-[#070812]' : 'border border-white/15 text-white/60 hover:border-white/30 hover:text-white'}`}
          >
            Workflow
          </button>
        </div>
      </div>

      {/* API key input */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
        <label className="block text-xs font-medium text-white/50 mb-2">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="arch_live_..."
          className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 placeholder:text-white/20 transition-colors"
        />
      </div>

      {/* Main 2-col grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Request panel */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="text-sm font-semibold mb-4 text-white">Request</div>

          {mode === 'tool' ? (
            <>
              <label className="block text-xs font-medium text-white/50 mb-2">
                Tool <span className="text-white/25">({TOOLS.length} available)</span>
              </label>
              <select
                value={tool}
                onChange={(e) => loadPreset(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 mb-4 transition-colors"
              >
                {TOOLS.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
              <label className="block text-xs font-medium text-white/50 mb-2">JSON body</label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={12}
                className="w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs text-white/85 outline-none focus:border-white/25 resize-none transition-colors"
              />
            </>
          ) : (
            <>
              <label className="block text-xs font-medium text-white/50 mb-2">
                Workflow steps — use{' '}
                <code className="text-cyan-400/80 font-mono">$last</code>{' '}
                to pass prior output
              </label>
              <textarea
                value={workflowSteps}
                onChange={(e) => setWorkflowSteps(e.target.value)}
                rows={14}
                className="w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs text-white/85 outline-none focus:border-white/25 resize-none transition-colors"
              />
            </>
          )}

          <button
            disabled={busy}
            onClick={run}
            className="mt-4 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#070812] hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#070812]/30 border-t-[#070812]" />
                Running…
              </span>
            ) : 'Run →'}
          </button>

          {err && (
            <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">
              {err}
            </div>
          )}
        </div>

        {/* Response panel */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-white">Response</div>
            {out && (
              <button
                onClick={() => navigator.clipboard?.writeText(JSON.stringify(out, null, 2))}
                className="text-xs text-white/35 hover:text-white/70 transition-colors"
              >
                Copy
              </button>
            )}
          </div>
          <pre className="max-h-[580px] overflow-auto rounded-xl bg-black/40 p-4 text-xs text-white/75 leading-relaxed">
            {out
              ? JSON.stringify(out, null, 2)
              : <span className="text-white/25">Run a request to see output here.</span>
            }
          </pre>
        </div>
      </div>
    </div>
  )
}
