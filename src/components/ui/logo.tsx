import { cn } from '@/lib/utils'

type LogoVariant = 'mark+wordmark' | 'mark' | 'wordmark'
type LogoSize    = 'sm' | 'md' | 'lg'
type LogoTheme   = 'light' | 'dark'

// ── Sizes ─────────────────────────────────────────────────────
const MARK_PX: Record<LogoSize, number> = { sm: 28, md: 32, lg: 48 }

const WORDMARK_CLASS: Record<LogoSize, string> = {
  sm: 'text-sm font-bold',
  md: 'text-base font-bold',
  lg: 'text-lg font-bold',
}

// ── Mark ──────────────────────────────────────────────────────
// Single-path Precision T:
//   - crossbar: x=4–28, y=7–14 (24 × 7px — wide, architectural)
//   - stem:     x=13–19, y=14–27 (6 × 13px — centered)
//   - 45° chamfers at both inner corners where stem meets crossbar
//     (L21 14 → L19 16 on the right, L13 16 → L11 14 on the left)
// This single path is what makes it feel designed, not typeset.
const MARK_PATH = 'M4 6 L28 6 L28 11 L21 11 L19 13 L19 27 L13 27 L13 13 L11 11 L4 11 Z'

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
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <path d={MARK_PATH} fill="white" />
    </svg>
  )
}

// ── Main export ───────────────────────────────────────────────
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

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {showMark && <LogoMark size={size} />}
      {showWordmark && (
        <span className={cn(
          WORDMARK_CLASS[size],
          theme === 'dark' ? 'text-white' : 'text-gray-900',
        )}>
          Tarhunna
        </span>
      )}
    </div>
  )
}
