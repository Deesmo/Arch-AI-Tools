'use client'

import { useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

const BENEFITS = [
  '100 free credits on signup — no card required',
  'Magic-link email verification, no passwords',
  'Keys are hashed, scoped, and revocable',
  'Free credits refresh monthly after verification',
]

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!email.trim()) { setErr('Please enter your email address'); return }
    setBusy(true); setErr(null)
    try {
      await apiFetch('/v1/auth/signup', { method: 'POST', body: JSON.stringify({ email: email.trim() }) })
      setDone(true)
    } catch (e: any) {
      setErr(e?.data?.detail || e?.message || 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-12 flex flex-col items-center">
      <div className="w-full max-w-md">

        {done ? (
          /* ── Success state ── */
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-8 text-center">
            <div className="text-4xl mb-4">📬</div>
            <h2 className="text-xl font-semibold text-white">Check your inbox</h2>
            <p className="mt-3 text-sm text-white/60 leading-relaxed">
              We sent a magic link to <span className="font-mono text-white/80">{email}</span>.
              Click it to verify your email and get your API key — it expires in 30 minutes.
            </p>
            <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-left text-xs text-white/40 leading-relaxed">
              <div className="font-medium text-white/60 mb-2">What happens next</div>
              <div>1. Click the link in your email</div>
              <div>2. Your API key is generated and shown once</div>
              <div>3. 100 free credits are added to your account</div>
              <div>4. Call any of the 30 tools immediately</div>
            </div>
            <button
              onClick={() => { setDone(false); setEmail('') }}
              className="mt-6 text-xs text-white/35 hover:text-white/60 transition-colors"
            >
              Use a different email
            </button>
          </div>
        ) : (
          /* ── Form state ── */
          <>
            <div className="mb-8">
              <h1 className="text-4xl font-semibold tracking-tight">Get your API key</h1>
              <p className="mt-3 text-white/55 leading-relaxed">
                Enter your email. We'll send a magic link — no password needed.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <label className="block text-xs font-medium text-white/45 mb-2">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !busy && submit()}
                placeholder="you@company.com"
                autoFocus
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white/90 outline-none focus:border-white/25 placeholder:text-white/20 transition-colors"
              />

              <button
                onClick={submit}
                disabled={busy}
                className="mt-4 w-full rounded-2xl bg-gradient-to-r from-indigo-500/90 to-cyan-500/90 px-4 py-3 text-sm font-semibold text-white hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Sending…
                  </span>
                ) : 'Send magic link →'}
              </button>

              {err && (
                <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">{err}</div>
              )}

              <p className="mt-4 text-xs text-white/30 text-center leading-relaxed">
                Tokens are single-use and expire in 30 minutes.
              </p>
            </div>

            {/* Benefits */}
            <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.02] p-5">
              <div className="text-xs font-semibold text-white/35 uppercase tracking-widest mb-3">What you get</div>
              <ul className="flex flex-col gap-2">
                {BENEFITS.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-sm text-white/55">
                    <span className="text-emerald-400/70 mt-0.5 shrink-0">✓</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-6 text-center text-xs text-white/30">
              Already have a key?{' '}
              <Link href="/dashboard" className="text-white/50 hover:text-white/80 transition-colors">Go to dashboard →</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
