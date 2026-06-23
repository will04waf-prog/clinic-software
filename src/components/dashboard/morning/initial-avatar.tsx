import { cn } from '@/lib/utils'
import { AVATAR_TINT_COLORS, type AvatarTint } from './avatar-tint'

/**
 * Avatar variant used in the morning-briefing dashboard. Differs from
 * the inbox's ContactAvatar in two ways:
 *   - Caller passes a pre-picked tint (the server decides) so the same
 *     contact reads the same color across action stack, schedule rail,
 *     and Up-Next card.
 *   - Sizes step up to lg (46px) and xl (52px) for the up-next card,
 *     where the avatar needs more visual weight.
 */

const SIZE: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-[12px]',
  lg: 'h-[46px] w-[46px] text-[13px]',
  xl: 'h-[52px] w-[52px] text-[14px]',
}

interface Props {
  initials: string
  tint: AvatarTint
  size?: keyof typeof SIZE
  className?: string
  ring?: boolean
}

export function InitialAvatar({ initials, tint, size = 'md', className, ring = false }: Props) {
  const c = AVATAR_TINT_COLORS[tint]
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide select-none',
        ring && 'ring-[3px] ring-[#F5EFE1]',
        SIZE[size],
        className,
      )}
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {initials}
    </span>
  )
}
