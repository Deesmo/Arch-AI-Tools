'use client'

import { useState, useEffect, useCallback } from 'react'

interface Tool {
  name: string
  price_usdc: string
  endpoint: string
  sample_params: Record<string, unknown>
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || (typeof window !== 'undefined' ? window.location.origin : 'https://archtools.dev')

export default function PlaygroundPage() {
  const [tools, setTools] = useState<Tool[]>([])
  const [mode, setMode] = useState<'live' | 'demo' | 'snippets'>('live')
  const [apiKey, setApiKey] = useState('')
  const [selectedTool, setSelectedTool] = useState('ip-lookup')
  const [jsonBody, setJsonBody] = useState('{}')
  const [response, setResponse] = useState<any>(null)
  const [demoResponse, setDemoResponse] = useState<any>(null)
  const [status, setStatus] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  // Fetch tools
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/x402/playground/tools`)
        const data = await res.json()
        if (data.ok) {
          setTools(data.tools)
          const def = data.tools.find((t: Tool) => t.name === 'ip-lookup') || data.tools[0]
          if (def) {
            setSelectedTool(def.name)
            setJsonBody(JSON.stringify(def.sample_params || {}, null, 2))
          }
        }
      } catch {
        // fallback to pricing
        try {
          const res = await fetch(`${API_BASE}/api/v1/x402/pricing`)
          const data = await res.json()
          if (data.ok && data.tools) {
            setTools(data.tools.map((t: any) => ({ name: t.tool, price_usdc: t.price_usdc, endpoint: t.endpoint, sample_params: {} })))
          }
        } catch { /* */ }
      }
    })()
  }, [])

  const currentTool = tools.find(t => t.name === selectedTool)

  const onToolChange = useCallback((name: string) => {
    setSelectedTool(name)
    const tool = tools.find(t => t.name === name)
    if (tool?.sample_params) {
      setJsonBody(JSON.stringify(tool.sample_params, null, 2))
    }
    setError(null)
    setResponse(null)
    setStatus(null)
  }, [tools])

  // Live run
  async function runLive() {
    setBusy(true)
    setError(null)
    setResponse(null)
    setStatus(null)

    let body: any
    try {
      body = JSON.parse(jsonBody)
    } catch (e: any) {
      setError('Invalid JSON: ' + e.message)
      setBusy(false)
      return
    }

    const start = performance.now()
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

      const res = await fetch(`${API_BASE}/v1/tools/${selectedTool}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const ms = Math.round(performance.now() - start)
      setElapsed(ms)
      setStatus(res.status)

      const text = await res.text()
      let json
      try { json = JSON.parse(text) } catch { json = { raw: text } }
      setResponse(json)
    } catch (e: any) {
      setError('Request failed: ' + e.message)
    }
    setBusy(false)
  }

  // Demo run
  async function runDemo() {
    setBusy(true)
    setDemoResponse(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/x402/playground/demo?tool=${selectedTool}`)
      const data = await res.json()
      setDemoResponse(data)
    } catch (e: any) {
      setDemoResponse({ error: e.message })
    }
    setBusy(false)
  }

  // Code snippets
  function getCurl() {
    const params = JSON.stringify(currentTool?.sample_params || {})
    return `# x402 flow: first call returns 402, then pay and retry

# Step 1: Initial request (returns 402 Payment Required)
curl -X POST ${API_BASE}/v1/tools/${selectedTool} \\
  -H "Content-Type: application/json" \\
  -d '${params}'

# Step 2: Retry with payment header
curl -X POST ${API_BASE}/v1/tools/${selectedTool} \\
  -H "Content-Type: application/json" \\
  -H "X-Payment: <base64-payment-payload>" \\
  -d '${params}'

# Or use an API key (skips x402)
curl -X POST ${API_BASE}/v1/tools/${selectedTool} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer arch_live_YOUR_KEY" \\
  -d '${params}'`
  }

  function getJs() {
    const params = JSON.stringify(currentTool?.sample_params || {}, null, 2)
    return `import { wrapFetch } from "@x402/fetch";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const walletClient = createWalletClient({
  account, chain: base, transport: http(),
});

const x402Fetch = wrapFetch(fetch, walletClient);

const response = await x402Fetch("${API_BASE}/v1/tools/${selectedTool}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(${params}),
});

const result = await response.json();
console.log(result);
// Cost: $${currentTool?.price_usdc || '0.001'} USDC per call`
  }

  function getPython() {
    const params = JSON.stringify(currentTool?.sample_params || {}, null, 4)
    return `import requests

# Option 1: API key (simplest)
response = requests.post(
    "${API_BASE}/v1/tools/${selectedTool}",
    headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer arch_live_YOUR_KEY",
    },
    json=${params},
)
result = response.json()
print(result)

# Option 2: x402 (autonomous agents)
# pip install x402-python
from x402 import X402Client

client = X402Client(private_key="0x...", network="base")
result = client.post(
    "${API_BASE}/v1/tools/${selectedTool}",
    json=${params},
)
print(result)
# Cost: $${currentTool?.price_usdc || '0.001'} USDC per call`
  }

  return (
    <div className="pt-14">
      {/* Hero */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300 font-semibold mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> x402 Playground — Live Demo
        </div>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Test x402 Payments Live</h1>
        <p className="mt-3 max-w-2xl text-white/55 leading-relaxed">
          Pick a tool, enter parameters, and watch the full x402 payment cycle — from 402 response to USDC settlement. 
          Pay $0.001 and see it work. Or use demo mode to explore without a wallet.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2 mb-6">
        {(['live', 'demo', 'snippets'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              mode === m
                ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                : 'border border-white/15 text-white/60 hover:border-white/30 hover:text-white'
            }`}
          >
            {m === 'live' ? '⚡ Live Mode' : m === 'demo' ? '🎯 Demo Mode' : '📋 Code Snippets'}
          </button>
        ))}
      </div>

      {/* ═══ LIVE MODE ═══ */}
      {mode === 'live' && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Request */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-white">Request</span>
              <span className="text-[10px] font-semibold bg-purple-500/25 text-purple-300 px-2 py-0.5 rounded uppercase">POST</span>
            </div>

            <label className="block text-xs font-medium text-white/50 mb-2">API Key <span className="text-white/25">(optional for x402)</span></label>
            <input
              type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="arch_live_... (leave blank for x402)"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 placeholder:text-white/20 mb-4"
            />

            <label className="block text-xs font-medium text-white/50 mb-2">Tool <span className="text-white/25">({tools.length} available)</span></label>
            <select value={selectedTool} onChange={e => onToolChange(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 mb-2">
              {tools.map(t => <option key={t.name} value={t.name}>{t.name} (${t.price_usdc})</option>)}
            </select>

            {currentTool && (
              <div className="inline-flex items-center gap-1.5 bg-blue-500/15 text-blue-300 text-xs font-semibold font-mono px-2.5 py-1 rounded-md mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                ${currentTool.price_usdc} USDC
              </div>
            )}

            <label className="block text-xs font-medium text-white/50 mb-2">JSON Body</label>
            <textarea value={jsonBody} onChange={e => setJsonBody(e.target.value)} rows={8}
              className="w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs text-white/85 outline-none focus:border-white/25 resize-none" />

            <button disabled={busy} onClick={runLive}
              className="mt-4 w-full rounded-2xl bg-gradient-to-r from-amber-500 via-pink-500 to-purple-600 px-4 py-3 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              {busy ? <span className="flex items-center justify-center gap-2"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Running…</span> : 'Run →'}
            </button>

            {error && <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>}
          </div>

          {/* Response */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-white">Response</span>
              {status && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${
                  status === 200 ? 'bg-emerald-500/20 text-emerald-300' : status === 402 ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'
                }`}>{status}</span>
              )}
            </div>

            <div className="rounded-xl bg-black/40 p-4 max-h-[400px] overflow-auto relative">
              {response ? (
                <>
                  <pre className="text-xs text-white/75 leading-relaxed font-mono">{JSON.stringify(response, null, 2)}</pre>
                  <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(response, null, 2))}
                    className="absolute top-2 right-2 text-xs text-white/30 hover:text-white/60">Copy</button>
                </>
              ) : (
                <div className="text-white/25 text-sm text-center py-12">Run a request to see the full x402 payment cycle here.</div>
              )}
            </div>

            {/* Timeline */}
            {response && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-3 text-xs">
                  <span className="w-6 h-6 rounded-md bg-blue-500/20 text-blue-400 flex items-center justify-center text-[11px] font-bold">1</span>
                  <span className="text-white/60">POST /v1/tools/{selectedTool}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="w-6 h-6 rounded-md bg-red-500/20 text-red-400 flex items-center justify-center text-[11px] font-bold">2</span>
                  <span className="text-white/60">{status === 402 ? '402 — Payment required' : apiKey ? 'Skipped (API key)' : 'Payment verified ✓'}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="w-6 h-6 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center text-[11px] font-bold">3</span>
                  <span className="text-white/60">{status === 402 ? 'Awaiting USDC payment…' : apiKey ? 'Using credits' : 'USDC settled'}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="w-6 h-6 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-bold">4</span>
                  <span className="text-white/60">{status === 200 ? `Executed in ${elapsed}ms` : '—'}</span>
                </div>
                <div className="flex gap-4 mt-3 pt-3 border-t border-white/5 text-[11px] font-mono text-white/40">
                  <span>Total: <span className="text-emerald-400">{elapsed}ms</span></span>
                  <span>Status: <span className={status === 200 ? 'text-emerald-400' : 'text-red-400'}>{status}</span></span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ DEMO MODE ═══ */}
      {mode === 'demo' && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="text-sm font-semibold mb-4">Demo Flow — No Wallet Required</div>
            <p className="text-xs text-white/50 mb-4">See the full x402 cycle simulated. No USDC needed.</p>

            <label className="block text-xs font-medium text-white/50 mb-2">Tool</label>
            <select value={selectedTool} onChange={e => onToolChange(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 mb-3">
              {tools.map(t => <option key={t.name} value={t.name}>{t.name} (${t.price_usdc})</option>)}
            </select>

            {currentTool && (
              <div className="inline-flex items-center gap-1.5 bg-blue-500/15 text-blue-300 text-xs font-semibold font-mono px-2.5 py-1 rounded-md mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />${currentTool.price_usdc} USDC
              </div>
            )}

            <button onClick={runDemo} disabled={busy}
              className="w-full rounded-2xl bg-cyan-500/15 border border-cyan-500/25 px-4 py-3 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50 transition-all">
              {busy ? 'Loading…' : '🎯 Run Demo Flow'}
            </button>

            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="text-xs font-semibold text-amber-300 mb-1">Want to try for real?</div>
              <div className="text-xs text-white/50">Fund your wallet with USDC on Base and use Live Mode.</div>
              <a href="/fund" className="inline-block mt-2 text-xs text-cyan-400 hover:text-cyan-300">Fund your wallet →</a>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold">Simulated Response</span>
              {demoResponse && <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">DEMO</span>}
            </div>
            <div className="rounded-xl bg-black/40 p-4 max-h-[520px] overflow-auto relative">
              {demoResponse ? (
                <>
                  <pre className="text-xs text-white/75 leading-relaxed font-mono">{JSON.stringify(demoResponse, null, 2)}</pre>
                  <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(demoResponse, null, 2))}
                    className="absolute top-2 right-2 text-xs text-white/30 hover:text-white/60">Copy</button>
                </>
              ) : (
                <div className="text-white/25 text-sm text-center py-16">Hit "Run Demo" to see a simulated x402 flow.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ CODE SNIPPETS ═══ */}
      {mode === 'snippets' && (
        <div>
          <div className="mb-6">
            <label className="block text-xs font-medium text-white/50 mb-2">Select Tool</label>
            <select value={selectedTool} onChange={e => onToolChange(e.target.value)}
              className="w-full max-w-md rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 mb-2">
              {tools.map(t => <option key={t.name} value={t.name}>{t.name} (${t.price_usdc})</option>)}
            </select>
            {currentTool && (
              <div className="inline-flex items-center gap-1.5 bg-blue-500/15 text-blue-300 text-xs font-semibold font-mono px-2.5 py-1 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />${currentTool.price_usdc} USDC
              </div>
            )}
          </div>

          {/* curl */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">curl</h3>
              <button onClick={() => navigator.clipboard?.writeText(getCurl())}
                className="text-xs text-white/30 hover:text-white/60">Copy</button>
            </div>
            <pre className="rounded-xl bg-black/40 p-4 text-xs text-white/75 leading-relaxed font-mono overflow-auto">{getCurl()}</pre>
          </div>

          {/* JavaScript */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">JavaScript — @x402/fetch</h3>
              <button onClick={() => navigator.clipboard?.writeText(getJs())}
                className="text-xs text-white/30 hover:text-white/60">Copy</button>
            </div>
            <pre className="rounded-xl bg-black/40 p-4 text-xs text-white/75 leading-relaxed font-mono overflow-auto">{getJs()}</pre>
          </div>

          {/* Python */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Python</h3>
              <button onClick={() => navigator.clipboard?.writeText(getPython())}
                className="text-xs text-white/30 hover:text-white/60">Copy</button>
            </div>
            <pre className="rounded-xl bg-black/40 p-4 text-xs text-white/75 leading-relaxed font-mono overflow-auto">{getPython()}</pre>
          </div>
        </div>
      )}

      {/* Flow explainer */}
      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-4">How x402 Payments Work</h2>
        <div className="grid gap-3 md:grid-cols-4">
          {[
            { icon: '📡', title: '1. Request', desc: 'Agent calls a tool endpoint. Just a normal HTTP POST.', color: 'blue' },
            { icon: '💳', title: '2. 402 Response', desc: 'Server returns 402 with payment details: amount, wallet, chain.', color: 'red' },
            { icon: '🔐', title: '3. Sign & Retry', desc: 'Agent signs USDC payment and retries with X-Payment header.', color: 'amber' },
            { icon: '✅', title: '4. Result', desc: 'Server verifies, executes, returns result. Under 2 seconds.', color: 'emerald' },
          ].map(({ icon, title, desc, color }) => (
            <div key={title} className={`rounded-xl border border-${color}-500/15 bg-${color}-500/5 p-4`}>
              <div className="text-lg mb-2">{icon}</div>
              <div className="text-xs font-semibold mb-1">{title}</div>
              <div className="text-xs text-white/50">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
