import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'The Complete Guide to MCP Servers for Claude | Arch Tools Blog',
  description: 'Everything you need to know about MCP (Model Context Protocol) servers for Claude, ChatGPT, Cursor, and every AI coding assistant in 2026.',
  keywords: 'MCP server, Model Context Protocol, Claude, ChatGPT, Cursor, AI tools, MCP guide, AI coding assistant',
  openGraph: {
    title: 'The Complete Guide to MCP Servers for Claude',
    description: 'A developer\'s guide to MCP servers — what they are, how they work, and how to use them.',
    url: 'https://archtools.dev/blog-mcp-guide',
    type: 'article',
  },
}

const MCP_CLIENTS = [
  { name: 'Claude Code', status: 'Native', note: '#1 AI coding tool 2026' },
  { name: 'ChatGPT / GPT-5', status: 'Native', note: 'MCP support added Q1 2026' },
  { name: 'GitHub Copilot', status: 'Native', note: 'Agent Mode' },
  { name: 'Cursor', status: 'Native', note: 'First adopter' },
  { name: 'Windsurf', status: 'Native', note: 'Codeium\'s AI editor' },
  { name: 'Gemini AI Studio', status: 'Native', note: 'Google MCP servers' },
  { name: 'Kiro', status: 'Native', note: 'Amazon\'s AI IDE' },
  { name: 'Cline / Continue', status: 'Native', note: 'Open-source agents' },
]

export default function BlogMcpGuide() {
  return (
    <article className="pt-12 max-w-3xl mx-auto flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 text-xs text-white/40">
          <Link href="/" className="hover:text-white/60 transition-colors">← Back to home</Link>
          <span>·</span>
          <time dateTime="2026-03-18">March 18, 2026</time>
          <span>·</span>
          <span>7 min read</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl leading-tight">
          The Complete Guide to MCP Servers for Claude
        </h1>
        <p className="text-lg text-white/55 leading-relaxed">
          MCP became the universal protocol for AI tool use in 2025. Here&apos;s everything a developer
          needs to know about MCP servers in 2026.
        </p>
      </div>

      <div className="h-px bg-white/10" />

      <div className="prose-dark flex flex-col gap-6 text-sm text-white/70 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold text-white mb-3">What Is MCP?</h2>
          <p>
            The <strong className="text-white/85">Model Context Protocol (MCP)</strong> is an open standard created by Anthropic
            that lets AI models discover and use external tools. Think of it as &quot;USB-C for AI&quot; —
            a universal plug that works with every AI assistant.
          </p>
          <p className="mt-3">
            Before MCP, every AI tool integration required custom code. If you wanted Claude to use a web
            scraper, you wrote a Claude-specific tool. If you wanted ChatGPT to use the same scraper, you
            wrote a separate OpenAI function call. MCP replaces all of that with a single protocol.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">How MCP Works (In 30 Seconds)</h2>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3 mt-3">
            <div className="flex items-start gap-3">
              <span className="text-white/25 font-mono text-xs shrink-0 mt-0.5">1.</span>
              <div>
                <span className="text-white/80 font-semibold">Discovery:</span>{' '}
                <span className="text-white/55">The AI client asks the MCP server: &quot;What tools do you have?&quot;</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-white/25 font-mono text-xs shrink-0 mt-0.5">2.</span>
              <div>
                <span className="text-white/80 font-semibold">Schema:</span>{' '}
                <span className="text-white/55">Server returns JSON schemas describing each tool&apos;s inputs and outputs</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-white/25 font-mono text-xs shrink-0 mt-0.5">3.</span>
              <div>
                <span className="text-white/80 font-semibold">Invocation:</span>{' '}
                <span className="text-white/55">When the AI decides to use a tool, it calls the server with the right parameters</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-white/25 font-mono text-xs shrink-0 mt-0.5">4.</span>
              <div>
                <span className="text-white/80 font-semibold">Response:</span>{' '}
                <span className="text-white/55">Server executes the tool and returns structured results back to the AI</span>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">Every Major AI Client Now Supports MCP</h2>
          <p>
            As of March 2026, MCP has achieved near-universal adoption:
          </p>
          <div className="mt-4 rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8 bg-white/[0.03]">
                  <th className="text-left px-4 py-2.5 text-white/50 font-semibold">Client</th>
                  <th className="text-left px-4 py-2.5 text-white/50 font-semibold">MCP Status</th>
                  <th className="text-left px-4 py-2.5 text-white/50 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {MCP_CLIENTS.map(({ name, status, note }) => (
                  <tr key={name} className="border-b border-white/5">
                    <td className="px-4 py-2.5 text-white/75 font-medium">{name}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-emerald-400/80">✓ {status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-white/40">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">What Makes a Good MCP Server?</h2>
          <p>Not all MCP servers are equal. Here&apos;s what to look for:</p>
          <div className="grid gap-3 mt-4">
            {[
              { title: 'Tool variety', desc: 'More tools = more capable agents. A server with 5 tools is useful; one with 50+ is a platform.' },
              { title: 'Billing that works for agents', desc: 'Per-call credit billing or x402 crypto payments let agents operate autonomously.' },
              { title: 'Reliable uptime', desc: 'Agents don\'t retry gracefully. If your MCP server is down, the agent\'s task fails.' },
              { title: 'Good schemas', desc: 'Clear, complete JSON schemas help the AI model use tools correctly on the first try.' },
              { title: 'Security', desc: 'SSRF protection, rate limits, input validation. MCP servers are internet-facing — they need to be hardened.' },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
                <span className="text-sm font-semibold text-white/80">{title}:</span>{' '}
                <span className="text-sm text-white/55">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">Using Arch Tools as Your MCP Server</h2>
          <p>
            Arch Tools provides a single MCP server URL that gives any AI client access to 58+ production tools:
          </p>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-xs mt-4">
            <div style={{ color: 'rgba(110,231,183,0.45)' }}># Add to your MCP client config (Claude, Cursor, etc.)</div>
            <div className="mt-1">
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>MCP Server URL: </span>
              <span style={{ color: 'rgba(103,232,249,0.85)' }}>https://archtools.dev/mcp</span>
            </div>
          </div>
          <p className="mt-3">
            That single URL gives your agent access to web scraping, screenshot capture, AI generation,
            image creation, data transformation, and dozens more tools — all with built-in billing,
            rate limiting, and SSRF protection.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">Setting Up MCP in Claude Code</h2>
          <p>Here&apos;s a quick setup for the most popular MCP client:</p>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-xs mt-4 leading-loose">
            <div style={{ color: 'rgba(110,231,183,0.45)' }}>// .claude/mcp.json</div>
            <div style={{ color: 'rgba(255,255,255,0.6)' }}>{'{'}</div>
            <div style={{ color: 'rgba(255,255,255,0.6)' }}>{'  "mcpServers": {'}</div>
            <div style={{ color: 'rgba(255,255,255,0.6)' }}>{'    "arch-tools": {'}</div>
            <div>
              {'      '}<span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;url&quot;</span>: <span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;https://archtools.dev/mcp&quot;</span>,
            </div>
            <div>
              {'      '}<span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;env&quot;</span>: {'{ '}
              <span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;ARCH_TOOLS_API_KEY&quot;</span>: <span style={{ color: 'rgba(103,232,249,0.85)' }}>&quot;at_sk_...&quot;</span>
              {' }'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)' }}>{'    }'}</div>
            <div style={{ color: 'rgba(255,255,255,0.6)' }}>{'  }'}</div>
            <div style={{ color: 'rgba(255,255,255,0.6)' }}>{'}'}</div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">The Future of MCP</h2>
          <p>
            MCP is still evolving. Key trends to watch in 2026-2027:
          </p>
          <ul className="list-disc list-inside space-y-2 mt-3 text-white/60">
            <li><strong className="text-white/75">Agent-to-agent MCP:</strong> Agents using other agents as MCP tools</li>
            <li><strong className="text-white/75">MCP marketplaces:</strong> Directories of MCP servers ranked by reliability and tool quality</li>
            <li><strong className="text-white/75">Payment-aware MCP:</strong> x402 integration letting agents negotiate prices and pay autonomously</li>
            <li><strong className="text-white/75">Multi-modal MCP:</strong> Tools that accept and return images, audio, and video natively</li>
          </ul>
        </section>

        <section>
          <div className="flex gap-3 mt-4">
            <Link href="/signin" className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors">
              Get started free →
            </Link>
            <Link href="/docs" className="rounded-2xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white/75 hover:border-white/30 hover:text-white transition-colors">
              View all tools
            </Link>
          </div>
        </section>
      </div>
    </article>
  )
}
