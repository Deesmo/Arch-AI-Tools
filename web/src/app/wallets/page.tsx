import Link from 'next/link'

const CODE_PYTHON = `from coinbase_agentkit import CdpWalletProvider

# Create a new agent wallet on Base
wallet = CdpWalletProvider.configure_with_wallet(
    api_key_id="YOUR_CDP_API_KEY_ID",
    api_key_secret="YOUR_CDP_API_KEY_SECRET",
    network_id="base-mainnet"
)

print(f"Agent wallet: {wallet.get_address()}")
# → Agent wallet: 0x1a2b3c4d...

# Fund this address with USDC on Base
# Then use it for x402 tool calls`

const CODE_TYPESCRIPT = `import { CdpEvmWalletProvider } from "@coinbase/agentkit";

// Create a new agent wallet on Base
const wallet = await CdpEvmWalletProvider.configureWithWallet({
  apiKeyId: process.env.CDP_API_KEY_ID!,
  apiKeySecret: process.env.CDP_API_KEY_SECRET!,
  networkId: "base-mainnet",
});

console.log("Agent wallet:", wallet.getAddress());
// → Agent wallet: 0x1a2b3c4d...

// Now fund this address with USDC and make x402 calls`

const CODE_X402_CALL = `import { payForTool } from "@x402/client";

// Agent makes a tool call with automatic x402 payment
const result = await payForTool({
  url: "https://archtools.dev/v1/tools/screenshot-capture",
  method: "POST",
  body: { url: "https://example.com", full_page: true },
  wallet,  // CDP wallet from above
});

console.log(result);
// → { ok: true, image: "data:image/png;base64,..." }`

export default function WalletsPage() {
  return (
    <div className="pt-12">
      {/* ── Header ── */}
      <div className="mb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300/80 font-semibold mb-4">
          <span style={{ color: '#10B981' }}>●</span> CDP AgentKit
        </div>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Create an Agent Wallet
        </h1>
        <p className="mt-3 max-w-2xl text-white/55 leading-relaxed">
          Use Coinbase Developer Platform (CDP) AgentKit to provision wallets for your AI agents.
          Agents get their own USDC wallet on Base, enabling autonomous x402 payments for tool calls.
        </p>
      </div>

      {/* ── What you need ── */}
      <div className="grid gap-4 md:grid-cols-3 mb-12">
        {[
          {
            title: 'CDP API keys',
            desc: 'Sign up at the Coinbase Developer Platform to get your API key ID and secret. Free to start.',
            icon: '🔑',
            link: 'https://portal.cdp.coinbase.com',
            linkLabel: 'Get CDP keys →',
          },
          {
            title: 'AgentKit SDK',
            desc: 'Install @coinbase/agentkit (TypeScript) or coinbase-agentkit (Python). Manages wallet creation + signing.',
            icon: '📦',
            link: 'https://docs.cdp.coinbase.com/agentkit/docs/welcome',
            linkLabel: 'AgentKit docs →',
          },
          {
            title: 'USDC on Base',
            desc: 'Fund the provisioned wallet with USDC on Base. $1 covers 100+ tool calls. Bridge or buy via Coinbase.',
            icon: '💰',
            link: '/fund',
            linkLabel: 'Fund wallet →',
          },
        ].map(({ title, desc, icon, link, linkLabel }) => (
          <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col">
            <div className="text-2xl mb-3">{icon}</div>
            <div className="text-sm font-semibold text-white mb-2">{title}</div>
            <div className="text-sm text-white/50 leading-relaxed flex-1">{desc}</div>
            <a
              href={link}
              target={link.startsWith('http') ? '_blank' : undefined}
              rel={link.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="mt-4 inline-flex items-center text-xs text-cyan-400/70 hover:text-cyan-300 transition-colors"
            >
              {linkLabel}
            </a>
          </div>
        ))}
      </div>

      {/* ── Code Examples ── */}
      <div className="flex flex-col gap-6 mb-12">
        <div>
          <p className="text-[11px] text-white/30 font-mono tracking-widest uppercase mb-2">Code examples</p>
          <h2 className="text-xl font-semibold text-white">Provision a wallet in 5 lines</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* TypeScript */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#3178C6', boxShadow: '0 0 5px #3178C6' }} />
              <span className="text-xs font-semibold text-white/60">TypeScript</span>
              <span className="ml-auto text-[10px] text-white/25 font-mono">npm i @coinbase/agentkit</span>
            </div>
            <pre className="p-4 font-mono text-xs leading-loose overflow-x-auto text-white/60">{CODE_TYPESCRIPT}</pre>
          </div>

          {/* Python */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#3776AB', boxShadow: '0 0 5px #3776AB' }} />
              <span className="text-xs font-semibold text-white/60">Python</span>
              <span className="ml-auto text-[10px] text-white/25 font-mono">pip install coinbase-agentkit</span>
            </div>
            <pre className="p-4 font-mono text-xs leading-loose overflow-x-auto text-white/60">{CODE_PYTHON}</pre>
          </div>
        </div>

        {/* x402 call example */}
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.04] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-blue-500/10">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#2775CA', boxShadow: '0 0 5px #2775CA' }} />
            <span className="text-xs font-semibold text-white/60">Making x402 tool calls with your wallet</span>
            <span className="ml-auto text-[10px] text-white/25 font-mono">npm i @x402/client</span>
          </div>
          <pre className="p-4 font-mono text-xs leading-loose overflow-x-auto text-white/60">{CODE_X402_CALL}</pre>
        </div>
      </div>

      {/* ── Arch Tools wallet API ── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-300/80 font-semibold">
            Coming soon
          </div>
        </div>
        <h3 className="text-base font-semibold text-white mb-2">Arch Tools Wallet API</h3>
        <p className="text-sm text-white/50 leading-relaxed mb-4">
          Soon you&apos;ll be able to provision agent wallets directly through Arch Tools. One API call creates a funded wallet
          ready for x402 payments — no CDP keys needed on your end.
        </p>
        <div className="rounded-xl bg-black/50 p-4 font-mono text-xs leading-loose overflow-auto">
          <div style={{ color: 'rgba(110,231,183,0.45)' }}>{'// Future: provision wallet via Arch Tools API'}</div>
          <div><span style={{ color: 'rgba(103,232,249,0.85)' }}>POST </span><span style={{ color: 'rgba(255,255,255,0.6)' }}>https://archtools.dev/v1/wallet/provision</span></div>
          <div style={{ color: 'rgba(255,255,255,0.3)' }}>Authorization: Bearer at_sk_...</div>
          <div style={{ color: 'rgba(255,255,255,0.3)' }}>{'{ "label": "my-research-agent" }'}</div>
          <div className="my-2" />
          <div style={{ color: 'rgba(167,139,250,0.9)' }}>← 201 Created</div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'{'}</div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'  "ok": true,'}</div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'  "wallet": { "address": "0x...", "network": "base-mainnet" }'}</div>
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>{'}'}</div>
        </div>
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/70">
          <strong>Requires CDP API keys on the server.</strong> When configured, this endpoint will be live at
          <code className="ml-1 text-cyan-300/70">POST /v1/wallet/provision</code>. The route exists but returns 503 until keys are set.
        </div>
      </div>

      {/* ── Resources ── */}
      <div className="flex flex-col gap-4 mb-12">
        <h2 className="text-xl font-semibold text-white">Resources</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { title: 'CDP AgentKit Docs', desc: 'Official Coinbase documentation for creating and managing agent wallets.', href: 'https://docs.cdp.coinbase.com/agentkit/docs/welcome' },
            { title: 'x402 Protocol Spec', desc: 'HTTP-native payment protocol. How agents pay for API calls with USDC.', href: 'https://www.x402.org' },
            { title: 'Coinbase Developer Portal', desc: 'Get your CDP API keys, manage projects, and explore onramp tools.', href: 'https://portal.cdp.coinbase.com' },
            { title: 'Arch Tools x402 Directory', desc: 'Machine-readable directory of all x402-enabled tools with pricing.', href: '/api/v1/x402/pricing' },
          ].map(({ title, desc, href }) => (
            <a
              key={title}
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:bg-white/[0.05] transition-colors group"
            >
              <div className="text-sm font-semibold text-white group-hover:text-cyan-300/90 transition-colors">{title} →</div>
              <div className="mt-1 text-xs text-white/40">{desc}</div>
            </a>
          ))}
        </div>
      </div>

      {/* ── CTA ── */}
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-transparent to-blue-500/8 p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-base font-semibold text-white">Got your wallet? Fund it.</div>
            <div className="mt-1 text-sm text-white/55">
              Send USDC to your agent&apos;s wallet on Base and start making x402 tool calls immediately.
            </div>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link
              href="/fund"
              className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors"
            >
              Fund your wallet →
            </Link>
            <Link
              href="/docs"
              className="rounded-2xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white/75 hover:border-white/30 hover:text-white transition-colors"
            >
              View API docs
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
