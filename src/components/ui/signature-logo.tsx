import { cn } from '@/lib/utils'

type SignatureLogoSize = 'sm' | 'md' | 'lg' | 'xl'
type SignatureLogoVariant = 'dark-bg' | 'light-bg'

const SIZE_CLASS: Record<SignatureLogoSize, string> = {
  sm: 'text-2xl',
  md: 'text-3xl',
  lg: 'text-5xl',
  xl: 'text-6xl sm:text-7xl',
}

const VARIANT_CLASS: Record<SignatureLogoVariant, string> = {
  'dark-bg': 'text-gradient-signature-dark',
  'light-bg': 'text-gradient-signature-light',
}

interface SignatureLogoProps {
  size?: SignatureLogoSize
  variant?: SignatureLogoVariant
  className?: string
}

export function SignatureLogo({
  size = 'md',
  variant = 'light-bg',
  className,
}: SignatureLogoProps) {
  return (
    <span
      aria-label="Tarhunna"
      className={cn(
        'font-signature leading-none select-none',
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className,
      )}
    >
      Tarhunna
    </span>
  )
}
