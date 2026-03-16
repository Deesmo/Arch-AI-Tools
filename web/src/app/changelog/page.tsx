const CHANGELOG_DATA = [
  {
    version: '1.8.0',
    date: '2026-03-15',
    sections: {
      Added: [
        '53 production-ready tools (up from 45) — new additions: fact-check, news-search, research-report, crypto-sentiment, crypto-ohlcv, token-lookup, crypto-fear-greed, workflow-agent',
        'MCP server-card.json with full tool annotations (readOnlyHint, destructiveHint, openWorldHint)',
        'Smithery HTTP transport support with configurable API key and base URL',
        'Resources: tool catalog (arch://tools/catalog) and quickstart guide (arch://docs/quickstart)',
        'Prompts: research-topic, fact-check-claim, analyze-url',
        'DALL-E 3 image generation (generate-image tool)',
        'ElevenLabs text-to-speech (text-to-speech tool)',
        'OpenAI Whisper audio transcription (transcribe-audio tool)',
        'Resend email delivery (send-email tool)',
        'Browser automation via Playwright (browser-task tool)',
        'Comprehensive legal pages (terms, privacy, AUP, refund, security, retention, subprocessors)',
      ],
      Changed: [
        'SSE transport upgraded to SSE + Streamable HTTP',
        'SSRF hardening on web-scrape and browser-task tools',
        'Improved rate limiting with plan-based tiers (free/pro/business)',
      ],
      Fixed: [
        'Stripe webhook idempotency (no duplicate credit grants)',
        'Registration rate limiting (5/IP/hour)',
      ],
    },
  },
  {
    version: '1.0.0',
    date: '2026-02-27',
    sections: {
      Added: [
        'Initial release with 8 core tools',
        'Agent authentication with hashed API keys',
        'Credit system with Stripe checkout',
        'PostgreSQL via Prisma ORM',
        'Render Blueprint deployment',
        'x402 USDC payment discovery',
      ],
    },
  },
]

const SECTION_COLORS: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  Added:   { dot: 'bg-emerald-400', text: 'text-emerald-300/80', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  Changed: { dot: 'bg-amber-400',   text: 'text-amber-300/80',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20'   },
  Fixed:   { dot: 'bg-blue-400',    text: 'text-blue-300/80',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20'    },
}

export default function ChangelogPage() {
  return (
    <div className="pt-12">
      <div className="flex flex-col gap-6 mb-12">
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/65">
            Release history
          </div>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Changelog
        </h1>
        <p className="max-w-2xl text-lg text-white/55 leading-relaxed">
          Every version of Arch Tools, documented. New tools, improvements, and fixes.
        </p>
      </div>

      <div className="flex flex-col gap-8">
        {CHANGELOG_DATA.map((release) => (
          <div
            key={release.version}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8 hover:bg-white/[0.05] transition-colors"
          >
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <span className="text-xl font-bold tracking-tight text-white">
                v{release.version}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-mono text-white/50">
                {release.date}
              </span>
            </div>

            <div className="flex flex-col gap-5">
              {Object.entries(release.sections).map(([sectionName, items]) => {
                const colors = SECTION_COLORS[sectionName] ?? SECTION_COLORS.Added
                return (
                  <div key={sectionName}>
                    <div className={`inline-flex items-center gap-1.5 rounded-full border ${colors.border} ${colors.bg} px-2.5 py-1 text-xs font-semibold ${colors.text} mb-3`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                      {sectionName}
                    </div>
                    <ul className="space-y-1.5 ml-1">
                      {items.map((item: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-white/60 leading-relaxed">
                          <span className="text-white/20 mt-1 shrink-0">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
