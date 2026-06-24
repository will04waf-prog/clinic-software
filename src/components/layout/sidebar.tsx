'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Upload,
  Kanban,
  CalendarCheck,
  Zap,
  Settings,
  LogOut,
  ShieldCheck,
  BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { LogoMark } from '@/components/ui/logo-mark'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard',            label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/leads',                label: 'Leads & Contacts', icon: Users },
  { href: '/import-contacts',      label: 'Import Contacts',  icon: Upload },
  { href: '/pipeline',             label: 'Pipeline',         icon: Kanban },
  { href: '/consultations',        label: 'Consultations',    icon: CalendarCheck },
  // In-page anchor — the dashboard scroll container has scroll-behavior:
  // smooth and the #performance heading has scroll-mt-24 so this jumps
  // smoothly. Never lights up the active state (handled below).
  { href: '/dashboard#performance', label: 'Analytics',       icon: BarChart3 },
  { href: '/automations',          label: 'Automations',      icon: Zap },
  { href: '/settings',             label: 'Settings',         icon: Settings },
]

/**
 * Dashboard sidebar. Long vertical gradient that starts on cream #F5EFE1
 * at the top — same color as the rest of the app body, so the logo and
 * nav appear to grow out of the page — then fades down into forest
 * #14241d where the bottom action buttons sit. Active nav items light up
 * in mint #02C39A.
 *
 * Solid-cream portion (top 55%) covers the logo and every nav item with
 * forest text. The bottom action buttons (Super Admin, Sign Out) live in
 * the forest zone with cream text.
 */
export function Sidebar({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="hidden md:flex h-full w-60 flex-col bg-[#F5EFE1]">
      {/* Logo strip — h-16 + mint hairline to match the top bars on
          every dashboard page, so the dividers all sit on one line. */}
      <div className="flex h-16 items-center border-b border-[#02C39A]/35 px-5">
        <LogoMark size="md" standalone />
      </div>

      {/* Nav — forest text on cream throughout */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          // pathname has no hash, so href.includes('#') guarantees in-
          // page anchor entries never light up — keeps Dashboard the
          // only active row on /dashboard.
          const active = href.includes('#') ? false : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100 active:scale-[0.98]',
                active
                  ? 'bg-[#02C39A]/15 text-[#14241d]'
                  : 'text-[#14241d]/75 hover:bg-[#14241d]/[0.06] hover:text-[#14241d]'
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-[#02C39A]' : 'text-[#14241d]/55')} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom actions — same cream bg, forest text */}
      <div className="border-t border-[#14241d]/10 p-3 space-y-0.5">
        {isSuperAdmin && (
          <Link
            href="/admin"
            prefetch
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#02C39A] hover:bg-[#02C39A]/10 transition-colors duration-100 active:scale-[0.98]"
          >
            <ShieldCheck className="h-4 w-4" />
            Super Admin
          </Link>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#14241d]/75 hover:bg-[#14241d]/[0.06] hover:text-[#14241d] transition-colors duration-150 active:scale-[0.98]"
        >
          <LogOut className="h-4 w-4 text-[#14241d]/55" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
