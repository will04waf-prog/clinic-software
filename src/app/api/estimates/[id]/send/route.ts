/**
 * POST /api/estimates/[id]/send — CRM-pivot LOOP.
 *
 * Owner-authenticated, org-scoped. Marks a draft (or already-sent)
 * estimate as 'sent', mints a single-purpose capability token, and
 * pings the CLIENT with the public approval link via notifyClient
 * (WhatsApp template → SMS → link-only). The link is ALWAYS returned so
 * the owner can share it manually if neither channel delivers.
 *
 * Idempotent-ish: re-sending is allowed. The status/sent_at bump is a
 * guarded UPDATE that only fires from 'draft'/'sent' — a viewed/approved
 * estimate is never dragged backwards — but we still re-notify + return
 * the link regardless, because "send it again" is a real owner need.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signCapabilityToken } from '@/lib/tokens/capability-token'
import { notifyClient } from '@/lib/notify/client'
import { resolveLocale } from '@/lib/i18n'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Guard req.json — this route carries no meaningful body, but a
  // malformed payload must not throw. Parse leniently and move on.
  try { await req.json() } catch { /* no body / bad JSON is fine here */ }

  // Load the estimate (org-scoped) + its client, so we know who to text
  // and in which language. Cookie client + org filter = RLS-safe.
  const { data: est } = await supabase
    .from('estimates')
    .select('id, organization_id, contact_id, status, contact:contacts(first_name, phone, preferred_language)')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .maybeSingle()
  if (!est) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', profile.organization_id)
    .single()

  const contact = Array.isArray(est.contact) ? est.contact[0] : est.contact

  // Guarded status bump: draft/sent → sent (+ sent_at). Never rolls a
  // viewed/approved estimate backwards. Non-fatal if it matches nothing.
  const nowIso = new Date().toISOString()
  await supabase
    .from('estimates')
    .update({ status: 'sent', sent_at: nowIso })
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .in('status', ['draft', 'sent'])

  const token = signCapabilityToken('estimate_approve', est.id)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tarhunna.net'
  const link = `${appUrl}/aprobar/${token}`

  const lang = resolveLocale(contact?.preferred_language)
  const businessName = org?.name || 'Tarhunna'
  const firstName = contact?.first_name || ''
  const smsBody = lang === 'es'
    ? `${businessName} le envió un estimado: ${link}`
    : `${businessName} sent you an estimate: ${link}`

  let channel: 'whatsapp' | 'sms' | 'none' = 'none'
  if (contact?.phone) {
    try {
      const result = await notifyClient({
        orgId: profile.organization_id,
        toPhone: contact.phone,
        lang,
        templateType: 'estimate_ready',
        variables: [firstName, businessName, link],
        smsBody,
        link,
      })
      channel = result.channel
    } catch (err) {
      console.error('[estimates/send] notifyClient failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, link, channel })
}
