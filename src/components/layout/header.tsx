'use client'

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header className="flex min-h-14 items-center justify-between gap-3 bg-[#14241d] text-[#F5EFE1] px-4 py-2 sm:px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-[#F5EFE1] sm:text-lg">{title}</h1>
        {subtitle && <p className="truncate text-xs text-[#F5EFE1]/65">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  )
}
