'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

type DashData = {
  agent: { name: string; plan: string; email: string; created: string } | null
  credits_remaining: number
  total_calls: number
  calls_today?: number
  api_keys: { prefix: string; label: string | null; createdAt: string }[]
  daily_usage: { date: string; calls: number; credits_used: number }[]
  tool_breakdown: { tool: string; calls: number; credits_used: number }[]
}

const PLAN_COLORS: Record<string, string> = {
  free:     'text-white/50 bg-white/5 border-white/10',
  pro:      'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
  business: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-xs font-medium text-white/40 uppercase tracking-widest mb-2">{label}</div>
      <div className="text-3xl font-bold tracking-tight text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-white/35">{sub}</div>}
    </div>
  )
}

function MiniBar({ pct, color = 'bg-indigo-400' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, Math.max(1, pct))}%` }} />
    </div>
  )
}

export default function DashboardPage() {
  const [apiKey, setApiKey] = useState('')
  const [data, setData] = useState<DashData | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [revoked, setRevoked] = useState<Set<string>>(new Set())

  // Auto-load from localStorage on mount
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('arch_api_key') : null
    if (saved) { setApiKey(saved); load(saved) }
  }, [])
  const inputRef = useRef<HTMLInputElement>(null)

  async function load(key = apiKey) {
    if (!key.trim()) { setErr('Paste your API key to load dashboard'); return }
    setBusy(true); setErr(null)
    try {
      const res = await apiFetch('/v1/agent/dashboard', { apiKey: key })
      setData(res)
      if (typeof window !== 'undefined') window.localStorage.setItem('arch_api_key', key)
    } catch (e: any) {
      setErr(e?.data?.detail || e?.message || 'Failed to load')
      setData(null)
    } finally {
      setBusy(false)
    }
  }

  async function revokeKey(prefix: string) {
    if (!confirm(`Revoke key ${prefix}? This cannot be undone.`)) return
    try {
      await apiFetch(`/v1/agent/keys/${prefix}`, { method: 'DELETE', apiKey })
      setRevoked(r => new Set([...r, prefix]))
    } catch (e: any) {
      alert(e?.data?.detail || e?.message || 'Revoke failed')
    }
  }

  const maxCalls = Math.max(1, ...(data?.tool_breakdown.map(t => t.calls) || [0]))

  return (
    <div className="pt-12">

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Dashboard</h1>
          <p className="mt-2 text-white/50 text-sm">Credit balance · usage · API keys</p>
        </div>
        <div className="flex gap-2">
          <Link href="/playground" className="rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/60 hover:border-white/25 hover:text-white transition-colors">Playground</Link>
          <Link href="/docs" className="rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/60 hover:border-white/25 hover:text-white transition-colors">Docs</Link>
        </div>
      </div>

      {/* API key input */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-6">
        <label className="block text-xs font-medium text-white/45 mb-2">API Key</label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="arch_live_..."
            className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 placeholder:text-white/20 transition-colors font-mono"
          />
          <button
            onClick={() => load()}
            disabled={busy}
            className="rounded-xl bg-white px-5 py-2 text-sm font-semibold text-[#070812] hover:bg-white/90 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#070812]/30 border-t-[#070812]" />
                Loading…
              </span>
            ) : 'Load data'}
          </button>
        </div>
        {err && <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">{err}</div>}
      </div>

      {data && (
        <div className="flex flex-col gap-6">

          {/* Upgrade CTA when credits < 50 */}
          {data.credits_remaining < 50 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-amber-300">⚠️ Low credits — {data.credits_remaining} remaining</div>
                <div className="text-xs text-white/50 mt-1">Top up now to keep your agents running without interruption.</div>
              </div>
              <Link href="/pricing" className="rounded-xl bg-gradient-to-r from-amber-500 to-pink-500 px-6 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity whitespace-nowrap">
                Upgrade Now →
              </Link>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Credits remaining"
              value={data.credits_remaining.toLocaleString()}
              sub={`Plan: ${data.agent?.plan ?? '—'}`}
            />
            <StatCard
              label="Total calls"
              value={data.total_calls.toLocaleString()}
              sub="all time"
            />
            <StatCard
              label="Active keys"
              value={data.api_keys.filter(k => !revoked.has(k.prefix)).length}
              sub="not revoked"
            />
            <StatCard
              label="Tools used"
              value={data.tool_breakdown.length}
              sub="distinct tools"
            />
          </div>

          {/* Agent info + plan badge */}
          {data.agent && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-white/40 uppercase tracking-widest mb-1">Account</div>
                  <div className="font-semibold text-white">{data.agent.name}</div>
                  <div className="text-sm text-white/50 mt-0.5">{data.agent.email}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${PLAN_COLORS[data.agent.plan] || PLAN_COLORS.free}`}>
                    {data.agent.plan}
                  </span>
                  <Link href="/pricing" className="text-xs text-white/40 hover:text-white/70 transition-colors">Upgrade →</Link>
                </div>
              </div>
            </div>
          )}

          {/* Tool breakdown + daily usage side-by-side */}
          <div className="grid gap-4 lg:grid-cols-2">

            {/* Tool breakdown */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Tool usage breakdown</div>
              {data.tool_breakdown.length === 0 ? (
                <p className="text-sm text-white/35">No tool calls recorded yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.tool_breakdown.slice(0, 12).map(({ tool, calls, credits_used }) => (
                    <div key={tool}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-xs text-white/75">{tool}</span>
                        <div className="flex gap-3 text-xs">
                          <span className="text-white/50">{calls.toLocaleString()} calls</span>
                          <span className="text-indigo-400/70">{credits_used.toLocaleString()} cr</span>
                        </div>
                      </div>
                      <MiniBar pct={(calls / maxCalls) * 100} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Daily usage (last 7 days) */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Daily usage — last 7 days</div>
              {data.daily_usage.length === 0 ? (
                <p className="text-sm text-white/35">No usage data yet.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.daily_usage.slice(0, 7).map(({ date, calls, credits_used }) => {
                    const maxDay = Math.max(1, ...data.daily_usage.slice(0, 7).map(d => d.calls))
                    return (
                      <div key={date} className="flex items-center gap-3">
                        <span className="text-xs text-white/35 font-mono w-20 shrink-0">{new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <div className="flex-1">
                          <MiniBar pct={(calls / maxDay) * 100} color="bg-cyan-400" />
                        </div>
                        <div className="flex gap-2 text-xs shrink-0">
                          <span className="text-white/50 w-16 text-right">{calls} calls</span>
                          <span className="text-cyan-400/60 w-16 text-right">{credits_used} cr</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Cost breakdown + savings calculator */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Estimated monthly spend */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Estimated monthly projection</div>
              {data.daily_usage.length > 0 ? (() => {
                const avgDaily = data.daily_usage.slice(0, 7).reduce((s, d) => s + d.credits_used, 0) / Math.min(7, data.daily_usage.length)
                const monthlyCredits = Math.round(avgDaily * 30)
                const monthlyCost = (monthlyCredits * 0.005).toFixed(2)
                return (
                  <div className="space-y-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-white/60">Avg daily usage</span>
                      <span className="text-lg font-bold text-white">{Math.round(avgDaily).toLocaleString()} credits</span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-white/60">Projected monthly</span>
                      <span className="text-lg font-bold text-white">{monthlyCredits.toLocaleString()} credits</span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-white/60">Estimated cost</span>
                      <span className="text-lg font-bold text-emerald-400">${monthlyCost}</span>
                    </div>
                    <div className="border-t border-white/8 pt-3">
                      <div className="text-xs text-white/35">
                        {monthlyCredits <= 1000 ? 'Starter ($9) covers your usage' :
                         monthlyCredits <= 10000 ? 'Pro ($49) recommended for your usage' :
                         'Business ($199) recommended for your usage'}
                      </div>
                    </div>
                  </div>
                )
              })() : (
                <p className="text-sm text-white/35">Not enough data yet — check back after a few days of usage.</p>
              )}
            </div>

            {/* Savings calculator */}
            <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.03] p-5">
              <div className="text-xs font-semibold text-emerald-400/60 uppercase tracking-widest mb-4">💰 You've saved vs separate API keys</div>
              {data.tool_breakdown.length > 0 ? (() => {
                const toolCategories = new Set(data.tool_breakdown.map(t => {
                  if (t.tool.includes('ai-') || t.tool === 'summarize' || t.tool.includes('sentiment') || t.tool.includes('entity') || t.tool.includes('pii') || t.tool.includes('regex')) return 'ai'
                  if (t.tool.includes('web') || t.tool.includes('scrape') || t.tool.includes('search') || t.tool.includes('extract')) return 'web'
                  if (t.tool.includes('crypto')) return 'crypto'
                  if (t.tool.includes('image') || t.tool.includes('design') || t.tool.includes('video') || t.tool.includes('tts') || t.tool.includes('speech') || t.tool.includes('ocr')) return 'media'
                  if (t.tool.includes('email') || t.tool.includes('webhook') || t.tool.includes('social')) return 'comm'
                  return 'utility'
                }))
                // Avg API key cost per category per month
                const keyCosts: Record<string, number> = { ai: 20, web: 15, crypto: 10, media: 25, comm: 10, utility: 5 }
                const savedAmount = Array.from(toolCategories).reduce((s, cat) => s + (keyCosts[cat] || 5), 0)
                return (
                  <div className="space-y-4">
                    <div className="text-3xl font-bold text-emerald-400">~${savedAmount}/mo</div>
                    <div className="text-sm text-white/50">
                      You're using tools across <strong className="text-white/75">{toolCategories.size} categories</strong> that would typically require {toolCategories.size} separate API subscriptions.
                    </div>
                    <div className="text-xs text-white/35 space-y-1">
                      {Array.from(toolCategories).map(cat => (
                        <div key={cat} className="flex justify-between">
                          <span className="capitalize">{cat === 'ai' ? 'AI/NLP' : cat === 'comm' ? 'Communication' : cat} APIs</span>
                          <span className="text-emerald-400/60">~${keyCosts[cat] || 5}/mo saved</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })() : (
                <p className="text-sm text-white/35">Start using tools to see your savings.</p>
              )}
            </div>
          </div>

          {/* API keys */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">API keys</div>
              <span className="text-xs text-white/30">{data.api_keys.filter(k => !revoked.has(k.prefix)).length} active</span>
            </div>
            {data.api_keys.length === 0 ? (
              <p className="text-sm text-white/35">No API keys found.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.api_keys.map(({ prefix, label, createdAt }) => {
                  const isRevoked = revoked.has(prefix)
                  return (
                    <div
                      key={prefix}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${
                        isRevoked ? 'border-white/5 bg-white/[0.01] opacity-40' : 'border-white/10 bg-black/20'
                      }`}
                    >
                      <div>
                        <div className="font-mono text-xs text-white/80">{prefix}••••••••</div>
                        <div className="text-xs text-white/35 mt-0.5">
                          {label || 'Unnamed'} · Created {new Date(createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      {!isRevoked ? (
                        <button
                          onClick={() => revokeKey(prefix)}
                          className="text-xs text-red-400/60 hover:text-red-300 transition-colors"
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="text-xs text-white/25">Revoked</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Recent activity</div>
            <button
              onClick={() => load()}
              className="mb-4 text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              ↻ Refresh
            </button>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/8">
                    <th className="pb-2 text-left font-medium text-white/35">Tool</th>
                    <th className="pb-2 text-right font-medium text-white/35">Credits</th>
                    <th className="pb-2 text-right font-medium text-white/35">Kind</th>
                    <th className="pb-2 text-right font-medium text-white/35">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {/* We use usage endpoint for recent_activity; dashboard has tool_breakdown */}
                  {data.tool_breakdown.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 font-mono text-white/70">{row.tool}</td>
                      <td className="py-2 text-right text-indigo-400/70">{row.credits_used}</td>
                      <td className="py-2 text-right text-white/35">debit</td>
                      <td className="py-2 text-right text-white/30">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.tool_breakdown.length === 0 && (
                <p className="text-sm text-white/35 mt-2">No activity yet. Try the <Link href="/playground" className="text-white/60 hover:text-white">playground</Link>.</p>
              )}
            </div>
          </div>

        </div>
      )}

      {!data && !busy && !err && (
        <div className="rounded-2xl border border-dashed border-white/10 p-16 text-center">
          <div className="text-white/25 text-sm">Enter your API key above and click Load data</div>
          <div className="mt-3 text-xs text-white/15">Don't have one yet? <Link href="/signin" className="text-white/35 hover:text-white/60">Sign up free →</Link></div>
        </div>
      )}

    </div>
  )
}
