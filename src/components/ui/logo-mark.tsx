import Image from 'next/image'
import { cn } from '@/lib/utils'

type LogoMarkSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASS: Record<LogoMarkSize, string> = {
  sm: 'h-7  w-auto',  // ~28px — for footer / small nav contexts
  md: 'h-11 w-auto',  // ~44px — primary nav, sidebar
  lg: 'h-16 w-auto',  // ~64px — section CTAs, auth headers
  xl: 'h-24 w-auto',  // ~96px — auth-page hero, large featured spots
}

interface LogoMarkProps {
  size?: LogoMarkSize
  className?: string
  /** Pass true when used standalone (no nearby wordmark) so the alt text
   *  actually conveys the brand to screen readers. Default is decorative —
   *  empty alt — for the historical case of the mark sitting next to the
   *  cursive wordmark. */
  standalone?: boolean
  priority?: boolean
}

export function LogoMark({
  size = 'md',
  className,
  standalone = false,
  priority = false,
}: LogoMarkProps) {
  return (
    <Image
      src="/tarhunna-mark.png"
      alt={standalone ? 'Tarhunna' : ''}
      width={540}
      height={488}
      quality={95}
      className={cn(SIZE_CLASS[size], className)}
      priority={priority}
    />
  )
}
