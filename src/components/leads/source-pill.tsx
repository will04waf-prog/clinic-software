import { Globe, Users, Footprints, HelpCircle } from 'lucide-react'
import type { LeadSource } from '@/types'
import { cn } from '@/lib/utils'

/**
 * Small icon + label badge for the lead's source channel. Used inline in
 * the leads list rows (next to the procedure chip) and in the conversation
 * header. Visual only — same data the contact already carries.
 *
 * Instagram + Facebook glyphs are inline SVGs because lucide-react v1.8
 * (the version this project ships) doesn't expose those names. Switching
 * to a newer lucide would touch the broader app; inline keeps the change
 * surface-area scoped to this restyle.
 */

type IconCmp = React.ComponentType<{ className?: string }>

const InstagramGlyph: IconCmp = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="5" ry="5" />
    <circle cx="12" cy="12" r="4" />
    <line x1="17.5" y1="6.5" x2="17.5" y2="6.5" />
  </svg>
)

const FacebookGlyph: IconCmp = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M22 12a10 10 0 1 0-11.563 9.875v-6.987H7.898V12h2.539V9.797c0-2.506 1.493-3.89 3.776-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.888h-2.33v6.987A10 10 0 0 0 22 12z" />
  </svg>
)

const SOURCE_LOOKUP: Record<LeadSource, { label: string; Icon: IconCmp; color: string; bg: string }> = {
  website:   { label: 'Website',   Icon: Globe,           color: '#0B2027', bg: '#E6F1F0' },
  referral:  { label: 'Referral',  Icon: Users,           color: '#0B2027', bg: '#EFEAE0' },
  instagram: { label: 'Instagram', Icon: InstagramGlyph,  color: '#C13584', bg: '#FBE9F3' },
  facebook:  { label: 'Facebook',  Icon: FacebookGlyph,   color: '#1877F2', bg: '#E7F0FE' },
  walkin:    { label: 'Walk-in',   Icon: Footprints,      color: '#3C3324', bg: '#F2E7E1' },
  other:     { label: 'Other',     Icon: HelpCircle,      color: '#1F2A37', bg: '#E8EAEE' },
}

interface SourcePillProps {
  source?: LeadSource | null
  className?: string
  showLabel?: boolean
}

export function SourcePill({ source, className, showLabel = true }: SourcePillProps) {
  if (!source) return null
  const entry = SOURCE_LOOKUP[source]
  if (!entry) return null
  const { label, Icon, color, bg } = entry
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
        className,
      )}
      style={{ backgroundColor: bg, color }}
    >
      <Icon className="h-3 w-3" />
      {showLabel && <span>{label}</span>}
    </span>
  )
}
