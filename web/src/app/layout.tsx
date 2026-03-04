import './globals.css'
import type { Metadata } from 'next'
import { Navbar } from '@/components/navbar'

export const metadata: Metadata = {
  title: 'Arch Tools — Infrastructure for AI Agents',
  description: '30 production-ready API tools for developers and AI agents. Authentication, credit billing, workflows, MCP, and x402 USDC payments built in.',
  keywords: 'API tools, AI agents, MCP, workflow engine, web scraping, sentiment analysis, developer tools',
  openGraph: {
    title: 'Arch Tools — Infrastructure for AI Agents',
    description: '30 production-ready API tools with auth, billing, and MCP support.',
    url: 'https://archtools.dev',
    siteName: 'Arch Tools',
    type: 'website',
  },
}

const FOOTER_LINKS = [
  { label: 'Docs', href: '/docs' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Playground', href: '/playground' },
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'OpenAPI', href: '/openapi.json' },
  { label: 'Status', href: '/v1/status' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="min-h-screen antialiased">
        <Navbar />
        <main className="mx-auto max-w-6xl px-6 pb-24">{children}</main>
        <footer className="border-t border-white/[0.07] mt-8">
          <div className="mx-auto max-w-6xl px-6 py-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-indigo-400/90 to-emerald-300/80" />
                  <span className="text-sm font-semibold text-white/80">Arch Tools</span>
                </div>
                <div className="text-xs text-white/30">© {new Date().getFullYear()} Arch Enterprises LLC · Columbia, SC</div>
              </div>
              <nav className="flex flex-wrap gap-x-5 gap-y-2">
                {FOOTER_LINKS.map(({ label, href }) => (
                  <a key={label} href={href} className="text-xs text-white/40 hover:text-white/70 transition-colors">{label}</a>
                ))}
              </nav>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
