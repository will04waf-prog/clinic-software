'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Building2, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/admin/home',     label: 'Home',     icon: LayoutDashboard },
  { href: '/admin/accounts', label: 'Accounts', icon: Building2 },
  { href: '/admin/users',    label: 'Users',    icon: Users },
]

export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav className="flex-1 px-3 py-4 space-y-1">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
            pathname.startsWith(href)
              ? 'bg-indigo-50 text-indigo-700 font-medium'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      ))}
    </nav>
  )
}
