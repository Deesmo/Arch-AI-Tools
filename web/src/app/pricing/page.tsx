import Link from 'next/link'

const TIERS = [
  {
    name: 'Starter Pack',
    price: '$9',
    credits: 3_000,
    blurb: 'For prototypes and weekend builds.',
    highlight: false,
    link: 'https://buy.stripe.com/fZu8wQdd19Y70LB8qF9fW06',
    per: '$0.003 / credit',
  },
  {
    name: 'Pro Pack',
    price: '$49',
    credits: 25_000,
    blurb: 'For serious developers shipping agents.',
    highlight: true,
    link: 'https://buy.stripe.com/5kQ14o4Gvc6f8e3cGV9fW07',
    per: '$0.00196 / credit',
  },
  {
    name: 'Business Pack',
    price: '$199',
    credits: 125_000,
    blurb: 'For teams and production workloads.',
    highlight: false,
    link: 'https://buy.stripe.com/bJecN65Kz1rBgKz5et9fW08',
    per: '$0.00159 / credit',
  },
]

const TOOL_COSTS = [
  { tier: 'Cheapest',  tools: 'validate-data, generate-hash, timezone-convert, generate-uuid', credits: 1,  examples: '3,000 calls / $9 pack' },
  { tier: 'Core',      tools: 'qr-code, convert-format, diff-text, phone-validate, currency-convert', credits: 2, examples: '1,500 calls / $9 pack' },
  { tier: 'Standard',  tools: 'transform-text, extract-metadata, readability-score, whois-lookup, email-verify, ip-lookup', credits: 3, examples: '1,000 calls / $9 pack' },
  { tier: 'Web',       tools: 'search-web, extract-page, rss-parse', credits: 4, examples: '750 calls / $9 pack' },
  { tier: 'Scrape',    tools: 'web-scrape', credits: 5, examples: '600 calls / $9 pack' },
  { tier: 'Extract',   tools: 'extract-pdf', credits: 6, examples: '500 calls / $9 pack' },
  { tier: 'AI light',  tools: 'language-detect, regex-generate', credits: 8, examples: '375 calls / $9 pack' },
  { tier: 'AI mid',    tools: 'sentiment-analysis, extract-entities, pii-detect, summarize, web-search', credits: 10, examples: '300 calls / $9 pack' },
  { tier: 'Browser',   tools: 'browser-task, ocr-extract', credits: 10, examples: '300 calls / $9 pack' },
  { tier: 'AI heavy',  tools: 'ai-generate (Claude)', credits: 20, examples: '150 calls / $9 pack' },
]

export default function PricingPage() {
  return (
    <div className="pt-12">

      {/* Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Pricing</h1>
        <p className="mt-3 max-w-2xl text-white/55 leading-relaxed">
          Credits never expire. Buy once and use as fast or slow as you need.
          Free accounts receive monthly credits after email verification — no card required.
        </p>
      </div>

      {/* Tier cards */}
      <div className="grid gap-5 md:grid-cols-3 mb-10">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={`rounded-2xl border p-6 flex flex-col ${
              t.highlight
                ? 'border-indigo-500/50 bg-indigo-500/[0.06] ring-1 ring-indigo-500/20'
                : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            {t.highlight && (
              <div className="mb-3 self-start inline-flex rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-300">
                Most popular
              </div>
            )}
            <div className="text-base font-semibold text-white">{t.name}</div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tracking-tight text-white">{t.price}</span>
              <span className="text-sm text-white/40">one-time</span>
            </div>
            <div className="mt-1 text-sm font-semibold text-white/55">{t.credits.toLocaleString()} credits</div>
            <div className="mt-0.5 text-xs text-white/30">{t.per}</div>
            <div className="mt-4 text-sm text-white/55 flex-1">{t.blurb}</div>
            <a
              href={t.link}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-6 block w-full rounded-2xl px-4 py-3 text-center text-sm font-semibold transition-opacity hover:opacity-90 ${
                t.highlight
                  ? 'bg-indigo-500 text-white'
                  : 'bg-white text-[#070812]'
              }`}
            >
              Buy {t.name} →
            </a>
          </div>
        ))}
      </div>

      {/* Free tier callout */}
      <div className="mb-10 rounded-2xl border border-white/10 bg-white/[0.02] p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div>
          <div className="font-semibold text-white">Free tier</div>
          <div className="mt-1 text-sm text-white/50 leading-relaxed">
            Verify your email and get 100 free credits each month. No credit card, no expiration.
          </div>
        </div>
        <Link
          href="/signin"
          className="shrink-0 rounded-2xl border border-white/15 px-5 py-3 text-sm font-semibold text-white/75 hover:border-white/30 hover:text-white transition-colors whitespace-nowrap"
        >
          Sign up free →
        </Link>
      </div>

      {/* Credit cost breakdown */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-10">
        <div className="text-sm font-semibold text-white mb-1">Credit cost per tool</div>
        <p className="text-xs text-white/40 mb-5">Credits debit on every successful call. Failed calls are not charged.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/8">
                <th className="pb-2.5 text-left font-medium text-white/35">Tier</th>
                <th className="pb-2.5 text-center font-medium text-white/35">Credits</th>
                <th className="pb-2.5 text-left font-medium text-white/35 hidden sm:table-cell">Tools</th>
                <th className="pb-2.5 text-right font-medium text-white/35 hidden md:table-cell">Value ($9 pack)</th>
              </tr>
            </thead>
            <tbody>
              {TOOL_COSTS.map(({ tier, tools, credits, examples }) => (
                <tr key={tier} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2.5 font-medium text-white/70">{tier}</td>
                  <td className="py-2.5 text-center">
                    <span className="inline-flex items-center justify-center rounded-full bg-indigo-500/15 text-indigo-300/80 font-semibold w-7 h-5 text-[11px]">
                      {credits}
                    </span>
                  </td>
                  <td className="py-2.5 text-white/40 font-mono hidden sm:table-cell">{tools}</td>
                  <td className="py-2.5 text-right text-white/35 hidden md:table-cell">{examples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ */}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { q: 'Do credits expire?', a: 'Never. Purchased credits carry over indefinitely. Free monthly credits are refreshed each calendar month.' },
          { q: 'What if a call fails?', a: 'Credits are only debited on successful tool executions. Errors (4xx, timeouts, validation failures) are free.' },
          { q: 'Is there a rate limit?', a: 'Yes — free accounts are rate-limited per minute. Pro and Business accounts get higher per-minute and daily caps.' },
        ].map(({ q, a }) => (
          <div key={q} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm font-semibold text-white mb-2">{q}</div>
            <div className="text-sm text-white/50 leading-relaxed">{a}</div>
          </div>
        ))}
      </div>

    </div>
  )
}
