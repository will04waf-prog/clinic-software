'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, CalendarCheck, Zap, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/dashboard',     label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads',         label: 'Leads',     icon: Users },
  { href: '/consultations', label: 'Consults',  icon: CalendarCheck },
  { href: '/automations',   label: 'Automations', icon: Zap },
  { href: '/settings',      label: 'Settings',  icon: Settings },
]

/**
 * Mobile bottom-tab nav. Mirrors the desktop sidebar's dark-forest +
 * mint-active treatment so the brand presence is consistent across
 * breakpoints.
 */
export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden bg-[#14241d] text-[#F5EFE1]">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            prefetch
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors duration-100 active:bg-[#F5EFE1]/[0.06] active:scale-[0.96]',
              active ? 'text-[#02C39A]' : 'text-[#F5EFE1]/70 hover:text-[#F5EFE1]'
            )}
          >
            <Icon className={cn('h-5 w-5', active ? 'text-[#02C39A]' : 'text-[#F5EFE1]/50')} />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
