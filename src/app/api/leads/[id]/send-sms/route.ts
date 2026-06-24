import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isTwilioConfigured, sendSMS, renderTemplate } from '@/lib/twilio'
import { formatProcedure } from '@/lib/utils'
import { disclosureFooter } from '@/lib/ai-twin'
import { levenshtein } from '@/lib/levenshtein'

const SendSchema = z.object({
  body:                     z.string().min(1, 'Message body is required').max(1600, 'Message is too long'),
  manual_consent_confirmed: z.boolean().optional(),
  // When present, this send is resolving an AI draft. The route
  // compares the sent body to the draft, computes edit distance,
  // marks the draft state ('sent' or 'edited'), and appends the
  // mandatory disclosure footer to the outbound. Without a draft_id
  // the route behaves exactly like the legacy manual-send path.
  draft_id:                 z.string().uuid().optional(),
  // The manual AI Draft button in the composer doesn't persist an
  // ai_drafts row — so there's no draft_id to bind. This flag tells
  // the send route the body was AI-authored so the disclosure footer
  // still gets appended. Composer sets this true after a successful
  // /draft-message call. Honest TCPA labeling on every AI send.
  is_ai_drafted:            z.boolean().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, organization:organizations(id, name)')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = profile.organization_id
  const org   = profile.organization as any

  // Explicit org scoping (belt + suspenders with RLS).
  const { data: contact } = await supabase
    .from('contacts_active')
    .select('id, first_name, phone, opted_out_sms, sms_consent, procedure_interest, organization_id')
    .eq('id', contactId)
    .eq('organization_id', orgId)
    .single()

  if (!contact)        return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!contact.phone)  return NextResponse.json({ error: 'no_phone', message: 'Contact has no phone number on file.' }, { status: 400 })

  // Hard block: STOP'd contacts. No override. Defense-in-depth — UI also disables.
  if (contact.opted_out_sms) {
    return NextResponse.json(
      { error: 'contact_opted_out', message: 'This contact has opted out of SMS messages.' },
      { status: 403 },
    )
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = SendSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { body: messageBody, manual_consent_confirmed, draft_id, is_ai_drafted } = parsed.data

  // ── AI draft resolution (Phase 1 W2) ─────────────────────
  // If the caller is sending an AI-drafted message, fetch the draft
  // up-front. We need its body to compute edit distance and to
  // know whether to append the disclosure footer. Use admin so
  // we can also UPDATE state below; org scoping is enforced by
  // re-checking the draft's organization_id matches the caller.
  let draft: { id: string; draft_body: string; state: string } | null = null
  if (draft_id) {
    const { data: foundDraft } = await supabaseAdmin
      .from('ai_drafts')
      .select('id, draft_body, state, organization_id, contact_id')
      .eq('id', draft_id)
      .single()
    if (foundDraft) {
      const sameOrg = foundDraft.organization_id === orgId
      const sameContact = foundDraft.contact_id === contactId
      const stillPending = foundDraft.state === 'pending'
      if (sameOrg && sameContact && stillPending) {
        draft = { id: foundDraft.id, draft_body: foundDraft.draft_body, state: foundDraft.state }
      } else {
        // Don't fail the send — the user has already typed and
        // hit send. Just log and proceed without resolving.
        console.warn('[send-sms] draft_id provided but unusable:', {
          sameOrg, sameContact, stillPending, draft_id,
        })
      }
    }
  }

  // Consent gate: contact without written consent requires explicit confirmation.
  if (!contact.sms_consent && manual_consent_confirmed !== true) {
    return NextResponse.json(
      { error: 'consent_confirmation_required', message: 'You must confirm consent before sending SMS to this contact.' },
      { status: 400 },
    )
  }

  if (!isTwilioConfigured()) {
    return NextResponse.json(
      { error: 'twilio_not_configured', message: 'SMS is not configured for this environment.' },
      { status: 503 },
    )
  }

  // Merge fields — match the email dialog's set so users have one mental model.
  const procedureName = (contact.procedure_interest ?? [])[0]
    ? formatProcedure((contact.procedure_interest as string[])[0])
    : ''
  const renderedBody = renderTemplate(messageBody, {
    first_name:     contact.first_name,
    clinic_name:    org?.name ?? '',
    procedure_name: procedureName,
  })

  // Append the mandatory AI-disclosure footer when this send is
  // either resolving a persisted AI draft (draft_id) OR was authored
  // via the manual AI Draft button (is_ai_drafted flag from composer).
  // The footer is added at the route layer, not in the composer, so
  // a non-AI manual send is never labeled and the user can't delete
  // the disclosure text from the composer.
  const isAiAuthored = draft != null || is_ai_drafted === true
  const finalOutboundBody = isAiAuthored
    ? renderedBody + disclosureFooter(org?.name ?? 'our clinic')
    : renderedBody

  let providerId: string | null = null
  let sendError:  string | null = null

  try {
    const result = await sendSMS(contact.phone, finalOutboundBody)
    if (!result) {
      sendError = 'Failed to send SMS. The phone number may be invalid.'
    } else {
      providerId = result.provider_id
    }
  } catch (err: any) {
    sendError = err?.message ?? 'Failed to send SMS'
  }

  const status = sendError ? 'failed' : 'sent'
  const now    = new Date().toISOString()

  // 1. messages — user-visible Message History card on contact detail page.
  //    We persist the body the patient actually received (footer included
  //    when applicable). The "sent" message id is captured for the
  //    ai_drafts back-reference below.
  const { data: insertedMessage } = await supabase.from('messages').insert({
    organization_id: orgId,
    contact_id:      contactId,
    channel:         'sms',
    direction:       'outbound',
    status,
    body:            finalOutboundBody,
    to_address:      contact.phone,
    provider_id:     providerId,
    error_message:   sendError,
    sent_at:         status === 'sent' ? now : null,
  }).select('id').single()

  // 2. sms_log — internal audit. Uses admin client because the sms_log RLS
  //    policy is read-only for authenticated users (no with-check on insert).
  await supabaseAdmin.from('sms_log').insert({
    organization_id: orgId,
    contact_id:      contactId,
    consultation_id: null,
    message_type:    draft ? 'ai_draft_sent' : 'manual',
    to_number:       contact.phone,
    body:            finalOutboundBody,
    status,
    provider_id:     providerId,
    error_message:   sendError,
  })

  // 3. activity_log — consent-confirmation trail lives here so we can audit
  //    no-consent overrides later. matches the email path's pattern.
  //    For AI-draft resolutions, we log the edit_distance + state so the
  //    Week-3 metrics tile can read it cheaply.
  let editDistance: number | null = null
  let draftState: 'sent' | 'edited' | null = null
  if (draft && status === 'sent') {
    // Compare against the draft body BEFORE the footer was appended —
    // we want to measure how much the human edited the actual content,
    // not detect the system-appended disclosure as an "edit."
    editDistance = levenshtein(messageBody.trim(), draft.draft_body.trim())
    draftState   = editDistance === 0 ? 'sent' : 'edited'
  }

  await supabase.from('activity_log').insert({
    organization_id: orgId,
    contact_id:      contactId,
    action:          draft ? `ai_draft_${draftState ?? 'send_failed'}` : 'sms_sent',
    metadata: {
      status,
      manual_consent_confirmed: manual_consent_confirmed === true,
      had_written_consent:      contact.sms_consent === true,
      ...(draft ? {
        draft_id:      draft.id,
        edit_distance: editDistance,
      } : {}),
    },
  })

  if (status === 'sent') {
    await supabase.from('contacts').update({ last_contacted_at: now }).eq('id', contactId)
  }

  // 4. ai_drafts resolution — only after a successful send. Failures
  //    leave the draft pending so the user can retry without losing
  //    the suggestion. Uses admin to bypass RLS on the UPDATE since
  //    the row was originally inserted by the inbound webhook
  //    (service-role).
  if (draft && status === 'sent') {
    await supabaseAdmin.from('ai_drafts').update({
      state:           draftState,
      edit_distance:   editDistance,
      sent_message_id: insertedMessage?.id ?? null,
      resolved_at:     now,
    }).eq('id', draft.id).eq('state', 'pending')
  }

  if (sendError) {
    return NextResponse.json({ error: 'sms_send_failed', message: sendError }, { status: 500 })
  }

  return NextResponse.json({ ok: true, draftResolution: draftState })
}
