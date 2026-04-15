'use client'

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header className="flex min-h-14 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2 sm:px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-gray-900 sm:text-lg">{title}</h1>
        {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  )
}
