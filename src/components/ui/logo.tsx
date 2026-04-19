import { useId } from 'react'
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

// Pipeline Apex — one discrete input bar plus an L-shaped pipeline that turns
// the corner at its top and exits as an arrow. Pipeline and arrow are one
// continuous path, so conversion is structural to the silhouette.
const PIPELINE_PATH =
  'M9 8.5 A1.5 1.5 0 0 1 10.5 7 L22 7 L22 3 L30 9 L22 15 L22 11 L13 11 L13 25.5 A1.5 1.5 0 0 1 11.5 27 L10.5 27 A1.5 1.5 0 0 1 9 25.5 Z'

function LogoMark({ size }: { size: LogoSize }) {
  const id = useId()
  const gradId = `tarhunna-mark-${id}`
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
      <defs>
        <linearGradient id={gradId} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </linearGradient>
      </defs>
      <rect x="3" y="17" width="4" height="10" rx="1.5" fill={`url(#${gradId})`} />
      <path d={PIPELINE_PATH} fill={`url(#${gradId})`} />
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
