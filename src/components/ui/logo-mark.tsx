import Image from 'next/image'
import { cn } from '@/lib/utils'

type LogoMarkSize = 'sm' | 'md' | 'lg' | 'xl'

// Smaller display sizes = less downscaling from the 540x488 source =
// sharper edges at render time. Tuned so the same mark still reads
// well at each nav/footer/auth context.
const SIZE_CLASS: Record<LogoMarkSize, string> = {
  sm: 'h-6  w-auto',  // ~24px — footer
  md: 'h-9  w-auto',  // ~36px — primary nav, in-app sidebar
  lg: 'h-14 w-auto',  // ~56px — section CTAs (dark panels)
  xl: 'h-20 w-auto',  // ~80px — auth-page hero
}

interface LogoMarkProps {
  size?: LogoMarkSize
  className?: string
  /** Pass true when used standalone (no nearby wordmark) so the alt text
   *  actually conveys the brand to screen readers. */
  standalone?: boolean
  priority?: boolean
}

/**
 * The Tarhunna T monogram. The wrapping span gets a CSS sheen sweep
 * (.logo-mark in globals.css) so the mark animates on the same 6s
 * rhythm as the signature cursive — giving them a shared brand
 * identity even though one is text and one is a PNG.
 */
export function LogoMark({
  size = 'md',
  className,
  standalone = false,
  priority = false,
}: LogoMarkProps) {
  return (
    <span className={cn('logo-mark', SIZE_CLASS[size], className)}>
      <Image
        src="/tarhunna-mark.png"
        alt={standalone ? 'Tarhunna' : ''}
        width={540}
        height={488}
        quality={95}
        priority={priority}
      />
    </span>
  )
}
