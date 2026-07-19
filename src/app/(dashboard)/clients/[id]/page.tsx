import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale } from '@/lib/i18n'
import { WhatsAppThread } from './whatsapp-thread'

/**
 * Client record — the WhatsApp thread (integrations build 2026-07-18).
 * Server component: resolves the contact via the cookie client (RLS
 * org-scopes it), then hands off to the polling thread UI.
 */
export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, organizations(owner_language)')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const org = (profile.organizations ?? null) as { owner_language?: string } | null
  const locale = resolveLocale(org?.owner_language)

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, phone')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .maybeSingle()
  if (!contact) notFound()

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || (locale === 'es' ? 'Cliente' : 'Client')

  return (
    <div className="h-full overflow-hidden">
      <WhatsAppThread
        locale={locale}
        contactId={contact.id}
        contactName={name}
        contactPhone={contact.phone ?? null}
      />
    </div>
  )
}
