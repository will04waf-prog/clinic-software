import Image from 'next/image'
import { cn } from '@/lib/utils'

type LogoVariant = 'mark+wordmark' | 'mark' | 'wordmark'
type LogoSize    = 'sm' | 'md' | 'lg'
type LogoTheme   = 'light' | 'dark'

const MARK_PX: Record<LogoSize, number> = { sm: 24, md: 32, lg: 56 }

const WORDMARK_CLASS: Record<LogoSize, string> = {
  sm: 'text-sm font-semibold tracking-tight',
  md: 'text-base font-semibold tracking-tight',
  lg: 'text-2xl font-semibold tracking-tight',
}

function LogoMark({ size }: { size: LogoSize }) {
  const px = MARK_PX[size]
  return (
    <Image
      src="/logo-mark.png"
      alt=""
      width={px}
      height={px}
      priority
      aria-hidden="true"
    />
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
    <div className={cn('flex items-center gap-1', inkClass, className)}>
      {showMark && <LogoMark size={size} />}
      {showWordmark && (
        <span className={cn(WORDMARK_CLASS[size])}>
          Tarhunna
        </span>
      )}
    </div>
  )
}
