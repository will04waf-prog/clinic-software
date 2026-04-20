'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Kanban,
  CalendarCheck,
  Zap,
  Settings,
  LogOut,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/ui/logo'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard',      label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/leads',          label: 'Leads & Contacts', icon: Users },
  { href: '/pipeline',       label: 'Pipeline',        icon: Kanban },
  { href: '/consultations',  label: 'Consultations',   icon: CalendarCheck },
  { href: '/automations',    label: 'Automations',     icon: Zap },
  { href: '/settings',       label: 'Settings',        icon: Settings },
]

export function Sidebar({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="hidden md:flex h-full w-60 flex-col border-r border-gray-200 bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-gray-200 px-5">
        <Logo size="md" />
      </div>

      {/* Nav */}
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
                  ? 'bg-indigo-50 text-indigo-700 active:bg-indigo-100'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100'
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-indigo-600' : 'text-gray-400')} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-gray-200 p-3 space-y-0.5">
        {isSuperAdmin && (
          <Link
            href="/admin"
            prefetch
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 transition-colors duration-100 active:scale-[0.98]"
          >
            <ShieldCheck className="h-4 w-4" />
            Super Admin
          </Link>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100 transition-colors duration-150 active:scale-[0.98]"
        >
          <LogOut className="h-4 w-4 text-gray-400" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
