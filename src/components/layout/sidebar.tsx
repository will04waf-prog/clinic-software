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
  FileText,
  CalendarDays,
  Receipt,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FEATURES } from '@/lib/features'
import { LogoMark } from '@/components/ui/logo-mark'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { getVerticalConfig, type Vertical } from '@/lib/vertical/config'
import { dict, resolveLocale } from '@/lib/i18n'

/** Title-case a single lowercase noun ('jobs' → 'Jobs'). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
 * #0B2027 where the bottom action buttons sit. Active nav items light up
 * in mint #02C39A.
 *
 * Solid-cream portion (top 55%) covers the logo and every nav item with
 * forest text. The bottom action buttons (Super Admin, Sign Out) live in
 * the forest zone with cream text.
 */
export function Sidebar({
  isSuperAdmin = false,
  isOwner = false,
  vertical = 'medspa',
  ownerLanguage,
}: {
  isSuperAdmin?: boolean
  isOwner?: boolean
  vertical?: Vertical
  ownerLanguage?: string
}) {
  const pathname = usePathname()
  const router = useRouter()

  // The /consultations nav label is the scheduled-thing noun. Med-spa keeps
  // its 'Consultations' literal (byte-identical); other verticals surface
  // their own plural (Jobs / Orders / Appointments). The route path is
  // unchanged. Its med-spa baseline is 'consultation', so we branch on the
  // literal rather than reaching for terms.engagement (which is
  // 'appointment' for med-spa) — see the config.ts BYTE-IDENTICAL note.
  const terms = getVerticalConfig(vertical).terms
  const consultationsLabel =
    vertical === 'medspa' ? 'Consultations' : cap(terms.engagementPlural)

  // Landscaping (loop) orgs get the Spanish loop nav; med-spa and every
  // other vertical keep the full CRM sidebar exactly as-is.
  type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; tierBadge?: 'Pro' }
  const navItems: NavItem[] = vertical === 'landscaping'
    ? (() => {
        const n = dict(resolveLocale(ownerLanguage)).nav
        return [
          { href: '/dashboard', label: n.home,      icon: LayoutDashboard },
          { href: '/estimates', label: n.estimates, icon: FileText },
          { href: '/invoices',  label: n.invoices,  icon: Receipt },
          { href: '/schedule',  label: n.schedule,  icon: CalendarDays },
          { href: '/settings',  label: n.settings,  icon: Settings },
        ]
      })()
    : NAV_ITEMS.filter((item) => item.href !== '/automations' || FEATURES.automations)

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
        {navItems.map((item) => {
          const { href, icon: Icon } = item
          const label = href === '/consultations' ? consultationsLabel : item.label
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
                  ? 'bg-[#02C39A]/15 text-[#0B2027]'
                  : 'text-[#0B2027]/75 hover:bg-[#0B2027]/[0.06] hover:text-[#0B2027]'
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-[#02C39A]' : 'text-[#0B2027]/55')} />
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
      <div className="border-t border-[#0B2027]/10 p-3 space-y-0.5">
        {isOwner && (
          <Link
            href="/settings/team"
            prefetch
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100 active:scale-[0.98]',
              pathname.startsWith('/settings/team')
                ? 'bg-[#02C39A]/15 text-[#0B2027]'
                : 'text-[#0B2027]/75 hover:bg-[#0B2027]/[0.06] hover:text-[#0B2027]',
            )}
          >
            <UserCog className={cn('h-4 w-4', pathname.startsWith('/settings/team') ? 'text-[#02C39A]' : 'text-[#0B2027]/55')} />
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
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#0B2027]/75 hover:bg-[#0B2027]/[0.06] hover:text-[#0B2027] transition-colors duration-150 active:scale-[0.98]"
        >
          <LogOut className="h-4 w-4 text-[#0B2027]/55" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
