import Link from 'next/link'

const SECTIONS = [
  {
    href: '/docs/quickstart',
    title: 'Quickstart',
    desc: 'Sign up, verify email, get an API key, and make your first tool call in under 5 minutes.',
    badge: 'Start here',
    badgeColor: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
  },
  {
    href: '/docs/tools',
    title: 'Tools reference',
    desc: 'All 30 tools with input schemas, credit costs, and response shapes.',
    badge: '30 tools',
    badgeColor: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/25',
  },
  {
    href: '/docs/workflows',
    title: 'Workflow engine',
    desc: 'Chain multiple tools sequentially. Pass output between steps using $last.',
    badge: 'Multi-step',
    badgeColor: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25',
  },
  {
    href: '/docs/agent',
    title: 'Agent runtime',
    desc: 'Submit a high-level task and let the agent plan and execute a bounded workflow.',
    badge: 'AI-powered',
    badgeColor: 'text-violet-300 bg-violet-500/10 border-violet-500/25',
  },
  {
    href: '/docs/browser-automation',
    title: 'Browser automation',
    desc: 'Playwright-powered headless browser: extract, click, type, or snapshot any page.',
    badge: 'Playwright',
    badgeColor: 'text-orange-300 bg-orange-500/10 border-orange-500/25',
  },
]

const QUICK_LINKS = [
  { label: 'OpenAPI spec', href: 'https://archtools.dev/openapi.json', ext: true },
  { label: 'Postman collection', href: 'https://archtools.dev/postman/collection', ext: true },
  { label: 'Python SDK', href: 'https://archtools.dev/sdk/python', ext: true },
  { label: 'Node SDK', href: 'https://archtools.dev/sdk/js', ext: true },
  { label: 'MCP server', href: 'https://arch-tools-mcp.onrender.com/mcp', ext: true },
  { label: 'Playground', href: '/playground', ext: false },
]

export default function DocsIndex() {
  return (
    <div className="pt-12">
      <div className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Docs</h1>
        <p className="mt-3 max-w-2xl text-white/55 leading-relaxed">
          Everything you need to integrate Arch Tools into your app or agent.
          Start with the quickstart, then explore the reference.
        </p>
      </div>

      {/* Main sections */}
      <div className="grid gap-3 mb-10">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:border-white/20 hover:bg-white/[0.05] transition-colors flex items-center justify-between gap-4"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2.5 mb-1">
                <span className="text-sm font-semibold text-white">{s.title}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${s.badgeColor}`}>{s.badge}</span>
              </div>
              <div className="text-sm text-white/45">{s.desc}</div>
            </div>
            <span className="text-white/25 shrink-0">→</span>
          </Link>
        ))}
      </div>

      {/* Quick links */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-10">
        <div className="text-xs font-semibold text-white/35 uppercase tracking-widest mb-4">Quick links</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {QUICK_LINKS.map(({ label, href, ext }) => (
            <a
              key={label}
              href={href}
              target={ext ? '_blank' : undefined}
              rel={ext ? 'noopener noreferrer' : undefined}
              className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-sm text-white/55 hover:border-white/18 hover:text-white/80 transition-colors flex items-center justify-between"
            >
              {label}
              {ext && <span className="text-white/20 text-xs">↗</span>}
            </a>
          ))}
        </div>
      </div>

      {/* Base URL */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="text-xs font-semibold text-white/35 uppercase tracking-widest mb-3">Base URL</div>
        <pre className="rounded-xl bg-black/40 px-4 py-3 text-xs font-mono text-white/70">https://archtools.dev</pre>
        <p className="mt-3 text-xs text-white/35 leading-relaxed">
          All endpoints follow REST conventions. Authenticate with{' '}
          <code className="font-mono text-white/55">Authorization: Bearer YOUR_API_KEY</code>.
          Credits are debited per successful tool call.
        </p>
      </div>
    </div>
  )
}
