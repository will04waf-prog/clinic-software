import { cn } from '@/lib/utils'

type SignatureLogoSize = 'sm' | 'md' | 'lg' | 'xl'
type SignatureLogoVariant = 'dark-bg' | 'light-bg'

const SIZE_CLASS: Record<SignatureLogoSize, string> = {
  sm: 'text-2xl',
  md: 'text-3xl',
  lg: 'text-5xl',
  xl: 'text-6xl sm:text-7xl',
}

const STATIC_VARIANT_CLASS: Record<SignatureLogoVariant, string> = {
  'dark-bg': 'text-gradient-signature-dark',
  'light-bg': 'text-gradient-signature-light',
}

const ANIMATED_VARIANT_CLASS: Record<SignatureLogoVariant, string> = {
  'dark-bg': 'text-gradient-signature-dark-anim',
  'light-bg': 'text-gradient-signature-light-anim',
}

interface SignatureLogoProps {
  size?: SignatureLogoSize
  variant?: SignatureLogoVariant
  animated?: boolean
  className?: string
}

export function SignatureLogo({
  size = 'md',
  variant = 'light-bg',
  animated = false,
  className,
}: SignatureLogoProps) {
  return (
    <span
      aria-label="Tarhunna"
      className={cn(
        'font-signature leading-none select-none',
        SIZE_CLASS[size],
        animated ? ANIMATED_VARIANT_CLASS[variant] : STATIC_VARIANT_CLASS[variant],
        animated && 'signature-animate',
        className,
      )}
    >
      Tarhunna
    </span>
  )
}
