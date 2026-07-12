import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { z } from 'zod'
import { enrollContact } from '@/lib/automation-engine'
import { enqueueEnrollment, enrollmentJobsMode } from '@/lib/enrollment-jobs'
import { makeRateLimiter } from '@/lib/public-rate-limit'
import { notifyOwnerOfLead, sendLeadAck } from '@/lib/lead-notifications'

// Public, unauthenticated endpoint that now triggers owner emails —
// cap submissions per org so a form-spamming bot can't turn the
// owner-alert feature into an inbox flood. 20/min is far above any
// human clinic's real lead rate.
const consumeCaptureSlot = makeRateLimiter(20, 60_000)

const CaptureSchema = z.object({
  first_name:          z.string().min(1),
  last_name:           z.string().optional(),
  email:               z.string().email().optional().or(z.literal('')),
  phone:               z.string().optional(),
  procedure_interest:  z.array(z.string()).optional(),
  notes:               z.string().optional(),
  sms_consent:         z.boolean().optional().default(false),
  /** 'waitlist' when submitted from the booking page's no-times state. */
  origin:              z.enum(['intake', 'waitlist']).optional().default('intake'),
})

// GET — verify slug is valid (used by the form page to load org info).
//
// Reads via the service-role client with an explicit 4-column allowlist,
// NOT the cookie/anon client. The public visitor has no session, so an
// anon read would depend on a permissive SELECT RLS policy on
// organizations — and a blanket anon policy exposes every column of
// every tenant (Stripe IDs, owner phone, Twilio/A2P config) to anyone
// with the public key. Service-role + a fixed column list scoped by slug
// returns only what the form needs and lets that anon policy be dropped.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug, procedures, vertical')
    .eq('slug', slug)
    .single()

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ org })
}

// POST — submit a lead from the public form.
//
// Public visitors filling out a clinic's intake form have no Supabase
// session, so the cookie-based anon client gets rejected by the
// org_isolation RLS policy on contacts. The slug in the URL is the
// authorization mechanism here — anyone who hits /api/capture/<slug>
// is implicitly permitted to create a lead for that specific org. We
// validate the slug, then use the service-role client to perform the
// writes, bypassing RLS in a controlled way.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan_status, trial_ends_at, sms_enabled, vertical, owner_language')
    .eq('slug', slug)
    .single()

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rl = consumeCaptureSlot(org.id)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many submissions — please try again in a minute.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  let body: unknown
  try { body = await request.json() } catch {
    // Malformed JSON from bots — a clean 400, not an uncaught
    // SyntaxError paging the operator via instrumentation.
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = CaptureSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { email, phone, sms_consent, ...rest } = parsed.data

  // Get default stage for org
  const { data: defaultStage } = await supabaseAdmin
    .from('pipeline_stages')
    .select('id')
    .eq('organization_id', org.id)
    .eq('is_default', true)
    .maybeSingle()

  // ── Dedup against existing contacts in this org ──────────────
  // Without this, a patient submitting the form twice (or filling it
  // once, navigating away, coming back, and filling it again) creates
  // two contact rows AND enrolls in `new_lead` sequences twice =
  // duplicate SMS sent to the same person. Match by email (preferred,
  // exact lowercase) or by last-10 digits of phone.
  const last10 = (phone ?? '').replace(/\D/g, '').slice(-10)
  let existingContact: { id: string } | null = null

  if (email) {
    const { data } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('organization_id', org.id)
      .eq('is_archived', false)
      .ilike('email', email)
      .maybeSingle()
    if (data) existingContact = data
  }
  if (!existingContact && last10.length === 10) {
    const { data: candidates } = await supabaseAdmin
      .from('contacts')
      .select('id, phone')
      .eq('organization_id', org.id)
      .eq('is_archived', false)
      .ilike('phone', `%${last10}`)
      .limit(5)
    const exact = (candidates ?? []).find(
      c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10
    )
    if (exact) existingContact = { id: exact.id }
  }

  let contactId: string
  if (existingContact) {
    // Bump last_activity_at + refresh consent if the visitor (re)opted in,
    // but do NOT re-enroll in new_lead sequences. Return the same id.
    const refresh: Record<string, unknown> = {
      last_activity_at: new Date().toISOString(),
    }
    if (sms_consent === true) refresh.sms_consent = true
    await supabaseAdmin
      .from('contacts')
      .update(refresh)
      .eq('id', existingContact.id)
    contactId = existingContact.id

    await supabaseAdmin.from('activity_log').insert({
      organization_id: org.id,
      contact_id:      contactId,
      action:          'lead_resubmitted',
      metadata:        { source: 'web_form', slug },
    })

    return NextResponse.json({ ok: true, deduped: true }, { status: 200 })
  }

  // New contact: insert + enqueue automations.
  const { data: contact, error } = await supabaseAdmin
    .from('contacts')
    .insert({
      organization_id:    org.id,
      stage_id:           defaultStage?.id ?? null,
      email:              email || null,
      phone:              phone || null,
      source:             'website',
      sms_consent:        sms_consent ?? false,
      ...rest,
      procedure_interest: rest.procedure_interest ?? [],
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  contactId = contact.id

  await supabaseAdmin.from('activity_log').insert({
    organization_id: org.id,
    contact_id:      contactId,
    action:          'lead_captured',
    // origin distinguishes booking-page waitlist leads from intake-form
    // leads (contacts.source stays 'website' for both — the UI's source
    // filters key on the LeadSource union).
    metadata:        { source: 'web_form', slug, origin: parsed.data.origin },
  })

  // Durable enrollment: /api/cron drains the queue. Shadow mode keeps the
  // legacy fire-and-forget alongside the enqueue until ENROLLMENT_JOBS_MODE=primary.
  try {
    await enqueueEnrollment({
      contactId,
      organizationId: org.id,
      triggerType:    'new_lead',
    })
  } catch {
    // Logged inside enqueueEnrollment
  }
  if (enrollmentJobsMode() === 'shadow') {
    enrollContact({
      contactId,
      triggerType:    'new_lead',
      organizationId: org.id,
    }).catch(console.error)
  }

  // Close the two silences (new contacts only — dedup returns above):
  // the owner hears about the lead, the patient hears they were heard.
  // after() so neither send delays the form response; failures log.
  const lead = {
    contactId,
    firstName:         parsed.data.first_name,
    lastName:          parsed.data.last_name ?? null,
    email:             email || null,
    phone:             phone || null,
    smsConsent:        sms_consent ?? false,
    procedureInterest: parsed.data.procedure_interest ?? [],
    notes:             parsed.data.notes ?? null,
    origin:            parsed.data.origin === 'waitlist' ? 'booking page (no times were open)' : 'intake form',
  }
  after(async () => {
    await notifyOwnerOfLead(org, lead).catch((err: unknown) =>
      console.error('[capture] owner alert failed:', err instanceof Error ? err.message : err))
    await sendLeadAck(org, lead).catch((err: unknown) =>
      console.error('[capture] lead ack failed:', err instanceof Error ? err.message : err))
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}
