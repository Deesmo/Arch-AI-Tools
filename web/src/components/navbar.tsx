'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

const NAV_LINKS = [
  { href: '/docs', label: 'Docs' },
  { href: '/playground', label: 'Playground' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/dashboard', label: 'Dashboard' },
]

export function Navbar() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#070812]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="relative h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-400/90 to-emerald-300/80 shadow-lg shadow-indigo-500/20">
            <div className="absolute inset-0 rounded-xl bg-white/10" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Arch Tools</div>
            <div className="text-[10px] text-white/40">Infrastructure for AI agents</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`rounded-xl px-3 py-2 text-sm transition-colors ${
                pathname?.startsWith(href)
                  ? 'bg-white/8 text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/docs"
            className="hidden rounded-xl border border-white/12 px-3 py-2 text-sm text-white/65 hover:border-white/25 hover:text-white transition-colors md:inline-flex"
          >
            View docs
          </Link>
          <Link
            href="/signin"
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors"
          >
            Get API key <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  )
}
