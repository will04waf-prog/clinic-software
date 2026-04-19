import { cn } from '@/lib/utils'

type LogoVariant = 'mark+wordmark' | 'mark' | 'wordmark'
type LogoSize    = 'sm' | 'md' | 'lg'
type LogoTheme   = 'light' | 'dark'

const MARK_PX: Record<LogoSize, number> = { sm: 24, md: 28, lg: 44 }

const WORDMARK_CLASS: Record<LogoSize, string> = {
  sm: 'text-sm font-semibold tracking-tight',
  md: 'text-base font-semibold tracking-tight',
  lg: 'text-xl font-semibold tracking-tight',
}

const MARK_BLUE = '#2563EB'

function LogoMark({ size }: { size: LogoSize }) {
  const px = MARK_PX[size]
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g stroke={MARK_BLUE} strokeWidth="1.3" strokeLinecap="round" fill="none">
        <line x1="7"  y1="16" x2="15" y2="8" />
        <line x1="15" y1="8"  x2="23" y2="9" />
        <line x1="15" y1="8"  x2="16" y2="16" />
        <line x1="23" y1="9"  x2="23" y2="19" />
        <line x1="7"  y1="16" x2="16" y2="16" />
        <line x1="16" y1="16" x2="17" y2="24" />
        <line x1="17" y1="24" x2="23" y2="19" />
      </g>
      <circle cx="7"  cy="16" r="3.2" fill={MARK_BLUE} />
      <circle cx="23" cy="9"  r="2.4" fill={MARK_BLUE} />
      <circle cx="23" cy="19" r="2.2" fill={MARK_BLUE} />
      <circle cx="16" cy="16" r="1.6" fill={MARK_BLUE} />
      <circle cx="15" cy="8"  r="2.2" stroke={MARK_BLUE} strokeWidth="1.5" fill="none" />
      <circle cx="17" cy="24" r="2.2" stroke={MARK_BLUE} strokeWidth="1.5" fill="none" />
    </svg>
  )
}

interface LogoProps {
  variant?:  LogoVariant
  size?:     LogoSize
  theme?:    LogoTheme
  className?: string
}

export function Logo({
  variant  = 'mark+wordmark',
  size     = 'md',
  theme    = 'light',
  className,
}: LogoProps) {
  const showMark     = variant !== 'wordmark'
  const showWordmark = variant !== 'mark'
  const inkClass     = theme === 'dark' ? 'text-white' : 'text-gray-900'

  return (
    <div className={cn('flex items-center gap-2.5', inkClass, className)}>
      {showMark && <LogoMark size={size} />}
      {showWordmark && (
        <span className={cn(WORDMARK_CLASS[size])}>
          Tarhunna
        </span>
      )}
    </div>
  )
}
