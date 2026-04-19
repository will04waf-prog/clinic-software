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

// Refined T — filled silhouette with deep 5px chamfers where crossbar
// meets stem. The chamfers carry the brand detail: lead flows into the
// booking. No backdrop; ink only, inherits color from context.
const MARK_PATH =
  'M4 7 L28 7 L28 12 L24 12 L19 17 L19 27 L13 27 L13 17 L8 12 L4 12 Z'

function LogoMark({ size }: { size: LogoSize }) {
  const px = MARK_PX[size]
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d={MARK_PATH} fill="currentColor" />
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
