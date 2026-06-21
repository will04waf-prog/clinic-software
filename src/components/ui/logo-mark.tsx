import Image from 'next/image'
import { cn } from '@/lib/utils'

type LogoMarkSize = 'sm' | 'md' | 'lg' | 'xl'

// Smaller display = less downscaling from the 540x488 source = sharper render.
// Size classes apply to the <img> directly (NOT the wrapper) so the image
// controls its own intrinsic aspect ratio. Mixing w-auto on the wrapper
// with width:100% on the img stretches on mobile Safari.
const SIZE_CLASS: Record<LogoMarkSize, string> = {
  sm: 'h-7  w-auto',  // ~28px — footer
  md: 'h-11 w-auto',  // ~44px — primary nav, in-app sidebar
  lg: 'h-16 w-auto',  // ~64px — section CTAs (dark panels)
  xl: 'h-24 w-auto',  // ~96px — auth-page hero
}

interface LogoMarkProps {
  size?: LogoMarkSize
  className?: string
  /** Pass true when used standalone (no nearby wordmark) so the alt text
   *  conveys the brand to screen readers. */
  standalone?: boolean
  priority?: boolean
}

/**
 * The Tarhunna T monogram. Wrapped in a span that hosts a CSS sheen sweep
 * (see .logo-mark in globals.css) so the mark animates on the same 6s
 * rhythm as the signature cursive — shared brand identity even though one
 * is text and the other is a PNG.
 */
export function LogoMark({
  size = 'md',
  className,
  standalone = false,
  priority = false,
}: LogoMarkProps) {
  return (
    <span className={cn('logo-mark', className)}>
      <Image
        src="/tarhunna-mark.png"
        alt={standalone ? 'Tarhunna' : ''}
        width={540}
        height={488}
        priority={priority}
        unoptimized
        className={SIZE_CLASS[size]}
      />
    </span>
  )
}
