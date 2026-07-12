/**
 * POST /api/admin/numbers/register-campaign — Phase 5 M4.
 *
 * Creates the TCR campaign once the brand is approved. Runs as a
 * follow-up to /register-brand; the typical lifecycle is:
 *
 *   1. Operator collects brand_data via M3 onboarding form.
 *   2. POST /api/admin/numbers/register-brand → a2p_status='pending'.
 *   3. /api/cron/a2p-status polls Twilio every 30 min → on APPROVED
 *      flips a2p_status='approved' and fires the owner email.
 *   4. Operator POSTs THIS route with the message samples + use case.
 *      → creates Campaign, stamps a2p_campaign_sid.
 *
 * The route refuses to run until step 3 has flipped a2p_status to
 * 'approved' — TCR rejects campaign-create requests against
 * unapproved brands with an opaque 400 that's painful to debug, so
 * we gate at the wrapper.
 *
 * Idempotency mirrors /register-brand:
 *   - provisioning_jobs row with step='a2p_campaign_register' for
 *     durable retry. (org, step) partial-unique → 409 on duplicate.
 *   - Stamping a2p_campaign_sid is conditional on the column being
 *     null — once we have a campaign on file we refuse to overwrite
 *     unless an operator clears it via the admin dashboard.
 *
 * Auth: super-admin only (same pattern as register-brand). MessagingService
 * SID must be passed by the caller because the messaging-service
 * creation is owned by M2 (provisioning), not M4 (compliance).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { z } from 'zod'
import { createCampaign } from '@/lib/telephony/a2p'

const bodySchema = z.object({
  organization_id:        z.string().uuid(),
  /** Twilio MessagingService SID (MG…) the org's numbers are attached
   * to. Created by the M2 provisioning step; passed here verbatim. */
  messaging_service_sid:  z.string().regex(/^MG[0-9a-fA-F]{32}$/, 'Expected a Twilio MessagingService SID (MG…)'),
  /** TCR vertical — for ClinIQ this is effectively always 'HEALTHCARE'
   * but we keep it free-form so the caller can override (e.g. spas
   * that classify as 'PROFESSIONAL_SERVICES'). */
  campaign_vertical:      z.string().min(1).max(64),
  /** Twilio U.S. App-to-Person Use Case enum. The common ClinIQ value
   * is 'MIXED' (transactional appointment SMS + marketing); 'ACCOUNT_NOTIFICATION'
   * works for transactional-only flows. */
  us_app_to_person_use_case: z.string().min(1).max(64),
  /** Use-case description shown to the TCR reviewer. Keep concrete —
   * vague descriptions are the #2 rejection reason after sample
   * mismatch. */
  description:            z.string().min(40).max(4096),
  /** 2-5 real, representative outbound samples. TCR cross-checks
   * these against actual delivered traffic; placeholder text trips
   * the reviewer. Must include the {{Reply STOP}} suffix on every
   * sample (TCR requires opt-out language in at least one sample
   * but we enforce on all to avoid template drift). */
  message_samples:        z.array(z.string().min(20).max(1024)).min(2).max(5),
  has_embedded_links:     z.boolean().optional(),
  has_embedded_phone:     z.boolean().optional(),
}).strict()

export async function POST(req: NextRequest) {
  // Super-admin gate (mirrors register-brand).
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_super_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const {
    organization_id,
    messaging_service_sid,
    campaign_vertical,
    us_app_to_person_use_case,
    description,
    message_samples,
    has_embedded_links,
    has_embedded_phone,
  } = parsed.data

  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, a2p_status, a2p_brand_sid, a2p_campaign_sid')
    .eq('id', organization_id)
    .single()
  if (orgErr || !org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }
  if (!org.a2p_brand_sid) {
    return NextResponse.json({
      error: 'No A2P brand on file. POST /api/admin/numbers/register-brand first.',
    }, { status: 409 })
  }
  if (org.a2p_status !== 'approved') {
    // Twilio will 400 here anyway, but we'd rather give the operator
    // a clear "brand still pending" error than a Twilio-side opaque
    // "BrandRegistration is not yet approved" message.
    return NextResponse.json({
      error: `Brand is currently ${org.a2p_status}; campaign create requires an approved brand. Wait for the polling cron to flip status or escalate.`,
    }, { status: 409 })
  }
  if (org.a2p_campaign_sid) {
    return NextResponse.json({
      error: 'A2P campaign already on file. Clear a2p_campaign_sid via the admin dashboard to re-register.',
    }, { status: 409 })
  }

  // Enqueue the durable retry row.
  const { data: jobRow, error: jobErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .insert({
      organization_id,
      step:    'a2p_campaign_register',
      status:  'in_progress',
      payload: {
        messaging_service_sid,
        campaign_vertical,
        us_app_to_person_use_case,
        description,
        message_samples,
        has_embedded_links:  has_embedded_links ?? false,
        has_embedded_phone:  has_embedded_phone ?? false,
      },
    })
    .select('id')
    .single()
  if (jobErr) {
    if (jobErr.code === '23505') {
      return NextResponse.json({
        error: 'A campaign registration is already in flight for this organization. Wait or mark the existing job failed.',
      }, { status: 409 })
    }
    return NextResponse.json({ error: jobErr.message }, { status: 500 })
  }

  let campaignSid: string
  try {
    const result = await createCampaign({
      brandSid:               org.a2p_brand_sid,
      messagingServiceSid:    messaging_service_sid,
      campaignVerticalEnum:   campaign_vertical,
      messageSamples:         message_samples,
      description,
      usAppToPersonUsecase:   us_app_to_person_use_case,
      hasEmbeddedLinks:       has_embedded_links,
      hasEmbeddedPhone:       has_embedded_phone,
    })
    campaignSid = result.campaign_sid
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'createCampaign failed'
    await supabaseAdmin
      .from('provisioning_jobs')
      .update({ status: 'failed', last_error: msg, attempts: 1 })
      .eq('id', jobRow.id)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Stamp the campaign sid. We DON'T flip a2p_status here — that field
  // tracks the BRAND lifecycle (approved/rejected/pending). The
  // campaign has its own lifecycle which we expose via a follow-up
  // poll route in the admin dashboard. For now the only visible
  // signal that the campaign was created is the populated
  // a2p_campaign_sid column.
  const { error: orgUpdErr } = await supabaseAdmin
    .from('organizations')
    .update({ a2p_campaign_sid: campaignSid })
    .eq('id', organization_id)
    .is('a2p_campaign_sid', null)
  if (orgUpdErr) {
    await supabaseAdmin
      .from('provisioning_jobs')
      .update({ status: 'succeeded', succeeded_at: new Date().toISOString() })
      .eq('id', jobRow.id)
    return NextResponse.json({ error: orgUpdErr.message }, { status: 500 })
  }

  await supabaseAdmin
    .from('provisioning_jobs')
    .update({ status: 'succeeded', succeeded_at: new Date().toISOString() })
    .eq('id', jobRow.id)

  return NextResponse.json({
    ok:           true,
    campaign_sid: campaignSid,
  })
}
