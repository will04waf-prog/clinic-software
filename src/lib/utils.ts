import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date, fmt = 'MMM d, yyyy') {
  return format(new Date(date), fmt)
}

export function formatDateTime(date: string | Date) {
  return format(new Date(date), 'MMM d, yyyy h:mm a')
}

export function formatRelative(date: string | Date) {
  const d = new Date(date)
  if (isToday(d)) return `Today ${format(d, 'h:mm a')}`
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`
  return formatDistanceToNow(d, { addSuffix: true })
}

export function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return phone
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function formatProcedure(procedure: string) {
  const map: Record<string, string> = {
    // Med spa
    botox:                'Botox',
    fillers:              'Fillers',
    lip_filler:           'Lip Filler',
    chemical_peel:        'Chemical Peel',
    microneedling:        'Microneedling',
    laser_hair_removal:   'Laser Hair Removal',
    hydrafacial:          'Hydrafacial',
    skin_tightening:      'Skin Tightening',
    prp:                  'PRP',
    body_contouring:      'Body Contouring',
    weight_loss:          'Weight Loss',
    other:                'Other',
    // Plastic surgery (kept so any existing records still render cleanly)
    rhinoplasty:          'Rhinoplasty',
    bbl:                  'BBL',
    liposuction:          'Liposuction',
    breast_augmentation:  'Breast Augmentation',
    breast_reduction:     'Breast Reduction',
    tummy_tuck:           'Tummy Tuck',
    facelift:             'Facelift',
    blepharoplasty:       'Blepharoplasty',
  }
  return map[procedure] ?? procedure
}

export function formatLeadSource(source: string) {
  const map: Record<string, string> = {
    website: 'Website',
    referral: 'Referral',
    instagram: 'Instagram',
    facebook: 'Facebook',
    walkin: 'Walk-In',
    other: 'Other',
  }
  return map[source] ?? source
}
