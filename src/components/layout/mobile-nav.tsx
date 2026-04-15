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

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t border-gray-200 bg-white">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors',
              active ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'
            )}
          >
            <Icon className={cn('h-5 w-5', active ? 'text-indigo-600' : 'text-gray-400')} />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
