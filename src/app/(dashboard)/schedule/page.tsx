/**
 * CRM-pivot LOOP — Schedule (Agenda).
 *
 * Server component: resolves the owner's language from
 * organizations.owner_language and hands the client agenda a locale.
 * Spanish-first (the loop default); English only when the owner set it.
 * The data itself is fetched client-side from /api/jobs so the list
 * can refresh after "Marcar completado" without a full reload.
 */

import { createClient } from '@/lib/supabase/server'
import { resolveLocale, type Locale } from '@/lib/i18n'
import { ScheduleView } from './schedule-view'

export default async function SchedulePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let locale: Locale = 'es'
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organizations(owner_language)')
      .eq('id', user.id)
      .single()
    const org = (Array.isArray(profile?.organizations)
      ? profile?.organizations[0]
      : profile?.organizations) as { owner_language?: string | null } | null
    locale = resolveLocale(org?.owner_language)
  }

  return <ScheduleView locale={locale} />
}
