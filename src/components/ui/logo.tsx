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

// Meridian / Apex — single continuous closed stroke.
// Left side: rounded sweep (the nurture curve).
// Right side: two straight edges meeting at a sharp apex (the booking moment).
// One mark, one gesture: unbroken follow-up with forward motion.
const MARK_PATH =
  'M3 16 C3 8 9 3 17 3 C20 3 20 5 23 8 L27 16 L23 24 C20 27 20 29 17 29 C9 29 3 24 3 16 Z'

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
      <path
        d={MARK_PATH}
        stroke="currentColor"
        strokeWidth={3.25}
        strokeLinejoin="miter"
        strokeLinecap="round"
        strokeMiterlimit={10}
      />
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
