'use client'

import Link from 'next/link'
import { useState } from 'react'

// ─── x402 tool pricing (mirrored from API — will be fetched dynamically when endpoint is live)
const TOOL_PRICING = [
  { tier: 'Micro',    range: '$0.001',  tools: 'validate-data, generate-hash, timezone-convert, generate-uuid, url-shorten, jsonpath-query, crypto-price, crypto-market-cap, crypto-fear-greed, token-lookup' },
  { tier: 'Basic',    range: '$0.002',  tools: 'qr-code, convert-format, diff-text, phone-validate, currency-convert, ip-lookup, barcode-generate, webhook-send, readability-score, crypto-ohlcv, crypto-sentiment, crypto-news, domain-check' },
  { tier: 'Standard', range: '$0.003',  tools: 'transform-text, extract-metadata, whois-lookup, email-verify, html-to-markdown, language-detect, email-send, news-search' },
  { tier: 'Web',      range: '$0.004–$0.006', tools: 'search-web, extract-page, rss-parse, web-scrape, extract-pdf, session-create, email-find' },
  { tier: 'AI',       range: '$0.008–$0.015', tools: 'sentiment-analysis, extract-entities, regex-generate, pii-detect, summarize, web-search, ocr-extract, browser-task, screenshot-capture, text-to-speech, transcribe-audio, fact-check, semantic-search, research-report' },
  { tier: 'Heavy AI', range: '$0.020–$0.030', tools: 'ai-generate, session-message, workflow-agent, ai-oracle, image-generate, design-create' },
  { tier: 'Premium',  range: '$0.050–$0.100', tools: 'video-generate' },
]

const FUNDING_STEPS = [
  {
    n: '01',
    title: 'Get a wallet',
    desc: 'Create a USDC wallet on Base using Coinbase, MetaMask, or any EVM wallet. Agents can use CDP AgentKit to self-provision.',
    icon: '👛',
  },
  {
    n: '02',
    title: 'Fund with USDC',
    desc: 'Buy USDC on Base via Coinbase, bridge from another chain, or receive from another wallet. $1 USDC = ~100–1,000 tool calls.',
    icon: '💵',
  },
  {
    n: '03',
    title: 'Call tools — pay per use',
    desc: 'Hit any Arch Tools endpoint. If no API key, the server returns a 402 with payment details. Your agent signs and pays in USDC automatically.',
    icon: '⚡',
  },
]

export default function FundPage() {
  const [showManual, setShowManual] = useState(false)

  return (
    <div className="pt-12">
      {/* ── Header ── */}
      <div className="mb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300/80 font-semibold mb-4">
          <span style={{ color: '#2775CA' }}>●</span> x402 / USDC on Base
        </div>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Fund Your Agent Wallet
        </h1>
        <p className="mt-3 max-w-2xl text-white/55 leading-relaxed">
          Arch Tools supports <strong className="text-white/80">x402 USDC payments</strong> — AI agents hold a wallet, discover tool costs in HTTP headers,
          and pay autonomously per call. No API key required. No human sign-off. Fund once, run thousands of calls.
        </p>
      </div>

      {/* ── How it works — 3 steps ── */}
      <div className="grid gap-4 md:grid-cols-3 mb-12">
        {FUNDING_STEPS.map(({ n, title, desc, icon }) => (
          <div key={n} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 hover:bg-white/[0.05] transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">{icon}</span>
              <span className="font-mono text-xs text-white/20">{n}</span>
            </div>
            <div className="text-sm font-semibold text-white mb-2">{title}</div>
            <div className="text-sm text-white/50 leading-relaxed">{desc}</div>
          </div>
        ))}
      </div>

      {/* ── Fund Options ── */}
      <div className="grid gap-5 md:grid-cols-2 mb-12">

        {/* Option 1: Coinbase Onramp */}
        <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/8 via-transparent to-indigo-500/6 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-lg">🏦</div>
            <div>
              <div className="text-sm font-semibold text-white">Buy USDC with Coinbase</div>
              <div className="text-xs text-white/40">Recommended — fastest path from fiat to funded</div>
            </div>
          </div>
          <p className="text-sm text-white/55 leading-relaxed mb-4">
            Coinbase Onramp lets you buy USDC directly with a debit card, bank account (ACH), or Apple Pay.
            USDC lands in your wallet on Base in under 2 minutes. Zero fees on USDC purchases for qualified apps.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://pay.coinbase.com/buy/select-asset?appId=cd116748-e1d9-4ac9-8eb7-b7c29e30fe14&defaultAsset=USDC&defaultNetwork=base&presetFiatAmount=25"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-500/90 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
            >
              Buy USDC on Coinbase →
            </a>
            <a
              href="https://www.coinbase.com/how-to-buy/usdc"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm text-white/65 hover:border-white/25 hover:text-white transition-colors"
            >
              Learn more
            </a>
          </div>
          <div className="mt-4 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-white/35">
            <strong className="text-white/50">Note:</strong> Coinbase Onramp widget integration requires a CDP Project ID.
            When available, the widget will embed directly on this page. For now, the link opens Coinbase in a new tab.
          </div>
        </div>

        {/* Option 2: Manual send */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-lg">📤</div>
            <div>
              <div className="text-sm font-semibold text-white">Send USDC directly</div>
              <div className="text-xs text-white/40">Already have USDC? Send to your agent wallet</div>
            </div>
          </div>
          <p className="text-sm text-white/55 leading-relaxed mb-4">
            If your agent already has a wallet, send USDC on Base directly. Works from any exchange, DEX,
            or wallet that supports Base (Coinbase, MetaMask, Rainbow, etc).
          </p>
          <button
            onClick={() => setShowManual(!showManual)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm text-white/65 hover:border-white/25 hover:text-white transition-colors"
          >
            {showManual ? 'Hide' : 'Show'} manual funding instructions
          </button>

          {showManual && (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-white/8 bg-black/20 p-4 font-mono text-xs leading-loose">
                <div className="text-emerald-400/70 mb-2">Steps to fund manually:</div>
                <div className="text-white/50">1. Open your wallet (Coinbase, MetaMask, etc.)</div>
                <div className="text-white/50">2. Select <span className="text-cyan-300/80">USDC</span> on the <span className="text-cyan-300/80">Base</span> network</div>
                <div className="text-white/50">3. Send to your agent&apos;s wallet address</div>
                <div className="text-white/50">4. Wait ~2 seconds for confirmation</div>
                <div className="text-white/50">5. Your agent can now make x402 tool calls</div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/70">
                ⚠️ Make sure you send <strong>USDC on Base</strong> (chain ID 8453). Sending to the wrong network means lost funds.
              </div>
            </div>
          )}
        </div>

        {/* Option 3: Other exchanges */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-lg">🔄</div>
            <div>
              <div className="text-sm font-semibold text-white">Bridge from another chain</div>
              <div className="text-xs text-white/40">Have USDC on Ethereum, Arbitrum, or Polygon?</div>
            </div>
          </div>
          <p className="text-sm text-white/55 leading-relaxed mb-4">
            Bridge USDC to Base using Coinbase's native bridge or third-party bridges like Across, Stargate, or Hop.
            Arch Tools accepts x402 payments on Base, Ethereum, Arbitrum, Polygon, Optimism, and Avalanche.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="https://bridge.base.org" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/55 hover:border-white/25 hover:text-white transition-colors">
              Base Bridge →
            </a>
            <a href="https://across.to" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/55 hover:border-white/25 hover:text-white transition-colors">
              Across →
            </a>
          </div>
        </div>

        {/* Option 4: For developers — API key + credits */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-lg">🔑</div>
            <div>
              <div className="text-sm font-semibold text-white">Prefer API keys + credits?</div>
              <div className="text-xs text-white/40">Traditional billing via Stripe</div>
            </div>
          </div>
          <p className="text-sm text-white/55 leading-relaxed mb-4">
            Not using x402? Sign up for a free account, get an API key, and use credit packs via Stripe.
            100 free credits on signup. No crypto wallet needed.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/signin"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors">
              Get API key free →
            </Link>
            <Link href="/pricing"
              className="inline-flex items-center rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm text-white/65 hover:border-white/25 hover:text-white transition-colors">
              View credit pricing
            </Link>
          </div>
        </div>
      </div>

      {/* ── x402 Flow Visualization ── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-12">
        <div className="text-sm font-semibold text-white mb-1">How x402 payments work</div>
        <p className="text-xs text-white/40 mb-5">HTTP-native micropayments — no checkout flow, no invoices, no human approval.</p>
        <div className="rounded-xl bg-black/50 p-5 font-mono text-xs leading-loose overflow-auto">
          <div style={{ color: 'rgba(110,231,183,0.45)' }}>{'// 1. Agent calls a tool with no API key'}</div>
          <div><span style={{ color: 'rgba(103,232,249,0.85)' }}>POST </span><span style={{ color: 'rgba(255,255,255,0.6)' }}>https://archtools.dev/v1/tools/screenshot-capture</span></div>
          <div style={{ color: 'rgba(255,255,255,0.3)' }}>Content-Type: application/json</div>
          <div style={{ color: 'rgba(255,255,255,0.3)' }}>{'{ "url": "https://example.com" }'}</div>
          <div className="my-2" />
          <div style={{ color: 'rgba(110,231,183,0.45)' }}>{'// 2. Server responds with 402 + payment details'}</div>
          <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>← 402 Payment Required</span></div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'{'}</div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'  "x402Version": 1,'}</div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'  "accepts": [{ "network": "eip155:8453", "maxAmountRequired": "10000", '}<span style={{ color: 'rgba(103,232,249,0.85)' }}>// $0.01 USDC</span></div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'              "payTo": "0x...", "asset": "0x833589fC..." }]'}</div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'}'}</div>
          <div className="my-2" />
          <div style={{ color: 'rgba(110,231,183,0.45)' }}>{'// 3. Agent signs USDC payment and retries with X-Payment header'}</div>
          <div><span style={{ color: 'rgba(103,232,249,0.85)' }}>POST </span><span style={{ color: 'rgba(255,255,255,0.6)' }}>https://archtools.dev/v1/tools/screenshot-capture</span></div>
          <div style={{ color: 'rgba(255,255,255,0.3)' }}>X-Payment: eyJwYXlsb2FkIjp7Li4ufSxi...</div>
          <div className="my-2" />
          <div style={{ color: 'rgba(110,231,183,0.45)' }}>{'// 4. Server verifies payment, executes tool, returns result'}</div>
          <div><span style={{ color: 'rgba(167,139,250,0.9)' }}>← 200 OK</span></div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'{ "ok": true, "image": "data:image/png;base64,..." }'}</div>
        </div>
      </div>

      {/* ── Tool Pricing Table ── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-12">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-semibold text-white">x402 tool pricing (USDC per call)</div>
          <a href="/api/v1/x402/pricing" target="_blank" rel="noopener noreferrer"
            className="text-xs text-cyan-400/70 hover:text-cyan-300 transition-colors font-mono">
            GET /api/v1/x402/pricing →
          </a>
        </div>
        <p className="text-xs text-white/40 mb-5">All prices in USDC. Failed calls are free. Prices are per successful execution.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/8">
                <th className="pb-2.5 text-left font-medium text-white/35">Tier</th>
                <th className="pb-2.5 text-center font-medium text-white/35">USDC / call</th>
                <th className="pb-2.5 text-left font-medium text-white/35 hidden sm:table-cell">Tools</th>
              </tr>
            </thead>
            <tbody>
              {TOOL_PRICING.map(({ tier, range, tools }) => (
                <tr key={tier} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2.5 font-medium text-white/70">{tier}</td>
                  <td className="py-2.5 text-center">
                    <span className="inline-flex items-center justify-center rounded-full bg-blue-500/15 text-blue-300/80 font-semibold px-2 h-5 text-[11px] font-mono">
                      {range}
                    </span>
                  </td>
                  <td className="py-2.5 text-white/40 font-mono hidden sm:table-cell text-[11px] leading-relaxed">{tools}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/40">
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400/70">$1 USDC</span> = ~100 screenshot calls
          </div>
          <span>·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400/70">$1 USDC</span> = ~1,000 hash/UUID calls
          </div>
          <span>·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400/70">$5 USDC</span> = serious agent pipeline
          </div>
        </div>
      </div>

      {/* ── Supported Networks ── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-12">
        <div className="text-sm font-semibold text-white mb-4">Supported payment networks</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            { name: 'Base',      type: 'USDC',     speed: '~2s',  icon: '🔵', primary: true },
            { name: 'Ethereum',  type: 'USDC/ETH',  speed: '~15s', icon: '⟠',  primary: false },
            { name: 'Arbitrum',  type: 'USDC',     speed: '~2s',  icon: '🔷', primary: false },
            { name: 'Polygon',   type: 'USDC',     speed: '~2s',  icon: '🟣', primary: false },
            { name: 'Optimism',  type: 'USDC',     speed: '~2s',  icon: '🔴', primary: false },
            { name: 'Avalanche', type: 'USDC',     speed: '~2s',  icon: '🔺', primary: false },
            { name: 'Solana',    type: 'USDC/SOL',  speed: '~1s',  icon: '◈',  primary: false },
            { name: 'BNB Chain', type: 'BNB',      speed: '~3s',  icon: '🟡', primary: false },
          ].map(({ name, type, speed, icon, primary }) => (
            <div
              key={name}
              className={`rounded-xl border p-3 ${
                primary ? 'border-blue-500/30 bg-blue-500/[0.06]' : 'border-white/8 bg-black/20'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">{icon}</span>
                <span className="text-xs font-semibold text-white/80">{name}</span>
                {primary && <span className="text-[9px] text-blue-300/70 bg-blue-500/15 rounded-full px-1.5 py-0.5 font-semibold">Recommended</span>}
              </div>
              <div className="text-[11px] text-white/40">{type} · {speed} settlement</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FAQ ── */}
      <div className="grid gap-4 md:grid-cols-3 mb-12">
        {[
          { q: 'How much should I fund?', a: '$1 USDC is enough for 100+ tool calls. Most agents doing light work need $5 or less for weeks of operation.' },
          { q: 'Can I use both x402 and API keys?', a: 'Yes. If you send an API key with credits, it\'s used first. x402 is the fallback for keyless or credit-exhausted requests.' },
          { q: 'What if a payment fails?', a: 'If payment verification fails, your USDC is not spent. The server returns a 402 error and you can retry. Nonce-based replay protection prevents double-spending.' },
        ].map(({ q, a }) => (
          <div key={q} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm font-semibold text-white mb-2">{q}</div>
            <div className="text-sm text-white/50 leading-relaxed">{a}</div>
          </div>
        ))}
      </div>

      {/* ── CTA ── */}
      <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-transparent to-blue-500/8 p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-base font-semibold text-white">Ready to fund your agent?</div>
            <div className="mt-1 text-sm text-white/55">
              Buy USDC, send to your wallet, and start calling tools. Or create a wallet with CDP AgentKit.
            </div>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link
              href="/wallets"
              className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors"
            >
              Create agent wallet →
            </Link>
            <a
              href="https://www.coinbase.com/how-to-buy/usdc"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white/75 hover:border-white/30 hover:text-white transition-colors"
            >
              Buy USDC on Coinbase
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
