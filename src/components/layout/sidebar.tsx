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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { LogoMark } from '@/components/ui/logo-mark'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard',        label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/leads',            label: 'Leads & Contacts', icon: Users },
  { href: '/import-contacts',  label: 'Import Contacts',  icon: Upload },
  { href: '/pipeline',         label: 'Pipeline',         icon: Kanban },
  { href: '/consultations',    label: 'Consultations',    icon: CalendarCheck },
  { href: '/automations',      label: 'Automations',      icon: Zap },
  { href: '/settings',         label: 'Settings',         icon: Settings },
]

/**
 * Dashboard sidebar. A long vertical gradient from forest #14241d at the
 * top, holding solid through the logo + nav items, then fading into the
 * cream body #F5EFE1 at the bottom — the same cream the rest of the app
 * sits on, so the sidebar dissolves into the body instead of butting up
 * against it. Active nav items light up in mint #02C39A.
 *
 * The gradient's solid-forest portion (top 55%) covers the logo and every
 * nav item; the bottom action buttons (Super Admin / Sign Out) sit in the
 * cream zone and switch to forest text for legibility.
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
    <aside
      style={{
        backgroundImage:
          'linear-gradient(180deg, #14241d 0%, #14241d 55%, #F5EFE1 100%)',
      }}
      className="hidden md:flex h-full w-60 flex-col"
    >
      {/* Logo — sits firmly in the forest zone */}
      <div className="flex h-16 items-center border-b border-[#F5EFE1]/10 px-5">
        <LogoMark size="md" standalone />
      </div>

      {/* Nav — every item is within the solid-forest 55%, so cream text
          stays legible. */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100 active:scale-[0.98]',
                active
                  ? 'bg-[#02C39A]/15 text-[#02C39A]'
                  : 'text-[#F5EFE1]/75 hover:bg-[#F5EFE1]/[0.06] hover:text-[#F5EFE1]'
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-[#02C39A]' : 'text-[#F5EFE1]/55')} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom actions — now resting on the cream end of the gradient,
          so flip text from cream to forest. Hover uses a low-opacity
          forest tint that contrasts gently against the cream. */}
      <div className="border-t border-[#14241d]/10 p-3 space-y-0.5">
        {isSuperAdmin && (
          <Link
            href="/admin"
            prefetch
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#14241d] hover:bg-[#14241d]/[0.06] transition-colors duration-100 active:scale-[0.98]"
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
