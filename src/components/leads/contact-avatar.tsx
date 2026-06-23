import { cn } from '@/lib/utils'

/**
 * Two-letter initials in a soft circle. Used in the leads list rows and as
 * the inbound-bubble avatar in the conversation thread, matching the
 * mockup. Deterministic colour per name so the same contact always reads
 * the same — six warm tints rotate via a simple hash.
 */

const TINTS = [
  { bg: '#FAF1E6', fg: '#8A6A3F' }, // peach
  { bg: '#E6F1F0', fg: '#0B2027' }, // ice teal
  { bg: '#EFEAE0', fg: '#3C3324' }, // sand
  { bg: '#E0F2EC', fg: '#0B5A4A' }, // sage mint
  { bg: '#F2E7E1', fg: '#7A3F2A' }, // clay
  { bg: '#E8EAEE', fg: '#1F2A37' }, // slate
] as const

function pickTint(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return TINTS[Math.abs(h) % TINTS.length]
}

function initialsOf(firstName?: string | null, lastName?: string | null) {
  const a = (firstName ?? '').trim().charAt(0)
  const b = (lastName ?? '').trim().charAt(0)
  return (a + b).toUpperCase() || '·'
}

type Size = 'sm' | 'md' | 'lg'
const SIZE: Record<Size, string> = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-[12px]',
  lg: 'h-12 w-12 text-sm',
}

interface ContactAvatarProps {
  firstName?: string | null
  lastName?: string | null
  size?: Size
  className?: string
}

export function ContactAvatar({
  firstName,
  lastName,
  size = 'md',
  className,
}: ContactAvatarProps) {
  const initials = initialsOf(firstName, lastName)
  const tint = pickTint(`${firstName ?? ''}${lastName ?? ''}` || initials)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide select-none',
        SIZE[size],
        className,
      )}
      style={{ backgroundColor: tint.bg, color: tint.fg }}
    >
      {initials}
    </span>
  )
}
