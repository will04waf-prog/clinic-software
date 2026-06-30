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
  ClipboardList,
  Sparkles,
  UserCog,
  Voicemail,
  PhoneCall,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FEATURES } from '@/lib/features'
import { LogoMark } from '@/components/ui/logo-mark'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard',            label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/leads',                label: 'Leads & Contacts', icon: Users },
  { href: '/import-contacts',      label: 'Import Contacts',  icon: Upload },
  { href: '/pipeline',             label: 'Pipeline',         icon: Kanban },
  { href: '/consultations',        label: 'Consultations',    icon: CalendarCheck },
  { href: '/calls',                label: 'Call log',         icon: PhoneCall },
  { href: '/voice-messages',       label: 'Voice messages',   icon: Voicemail },
  { href: '/automations',          label: 'Automations',      icon: Zap },
  // AI Twin operational surfaces. /ai-drafts/review is the daily
  // inbox of pending + resolved AI drafts (every tier uses it
  // because the manual AI Draft button persists drafts on Pro+
  // and the autonomous path persists them on Scale). The audit
  // page is the full filterable history of every twin action.
  { href: '/ai-drafts/review',     label: 'AI Drafts',        icon: Sparkles },
  { href: '/ai-twin/audit',        label: 'AI Twin audit',    icon: ClipboardList, tierBadge: 'Pro' as const },
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
export function Sidebar({
  isSuperAdmin = false,
  isOwner = false,
}: {
  isSuperAdmin?: boolean
  isOwner?: boolean
}) {
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
        {NAV_ITEMS.filter((item) => item.href !== '/automations' || FEATURES.automations).map((item) => {
          const { href, label, icon: Icon } = item
          const tierBadge = 'tierBadge' in item ? item.tierBadge : undefined
          const active =
            href === '/settings'
              ? pathname === '/settings' ||
                (pathname.startsWith('/settings/') && !pathname.startsWith('/settings/team'))
              : pathname.startsWith(href)
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
              <span className="flex-1">{label}</span>
              {tierBadge && (
                <span className="inline-flex items-center rounded-full bg-[#028090]/15 px-1.5 py-0 text-[9.5px] font-semibold uppercase tracking-wide text-[#028090]">
                  {tierBadge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Bottom actions — same cream bg, forest text */}
      <div className="border-t border-[#14241d]/10 p-3 space-y-0.5">
        {isOwner && (
          <Link
            href="/settings/team"
            prefetch
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100 active:scale-[0.98]',
              pathname.startsWith('/settings/team')
                ? 'bg-[#02C39A]/15 text-[#14241d]'
                : 'text-[#14241d]/75 hover:bg-[#14241d]/[0.06] hover:text-[#14241d]',
            )}
          >
            <UserCog className={cn('h-4 w-4', pathname.startsWith('/settings/team') ? 'text-[#02C39A]' : 'text-[#14241d]/55')} />
            Team
          </Link>
        )}
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
        {isSuperAdmin && (
          <Link
            href="/admin/numbers"
            prefetch
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#02C39A] hover:bg-[#02C39A]/10 transition-colors duration-100 active:scale-[0.98]"
          >
            <PhoneCall className="h-4 w-4" />
            Number health
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
