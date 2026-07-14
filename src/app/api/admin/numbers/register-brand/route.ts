/**
 * POST /api/admin/numbers/register-brand — Phase 5 M4.
 *
 * Takes the A2P brand-registration payload captured by the onboarding
 * form (M3) and kicks off the Twilio brand-creation flow. The
 * synchronous part of the call mints the BrandRegistration SID and
 * stamps it on organizations.a2p_brand_sid + flips a2p_status to
 * 'pending'; the cron at /api/cron/a2p-status then polls Twilio every
 * 30 min until terminal state.
 *
 * Why we enqueue a provisioning_jobs row alongside the synchronous
 * call: the M5 queue runner is what owns retry semantics. The
 * synchronous create here is the FAST PATH for the typical happy
 * case — if Twilio is up, we hand the operator back a brand sid in
 * one request. If Twilio is down or returns a 5xx, the queued row
 * is what makes recovery automatic: the queue's exponential-backoff
 * retry picks it up, replays createBrand with the stored payload,
 * and the operator never has to manually re-trigger.
 *
 * Auth: super-admin only via profile.is_super_admin (same pattern as
 * src/app/api/admin/accounts/[id]/route.ts). Org-level owners DO NOT
 * call this directly — onboarding (M3) gates the form behind a
 * separate user-facing endpoint that posts here via service-role.
 * That keeps the EIN-bearing payload from being writable by anyone
 * other than the super-admin or the onboarding flow itself.
 *
 * Idempotency:
 *   - The (org, step) partial-unique index on provisioning_jobs raises
 *     23505 if a brand-register row is already pending/in_progress/
 *     succeeded. We return 409 in that case rather than enqueueing a
 *     duplicate. Operator can mark the failed row as such via the
 *     admin dashboard to retry.
 *   - The DB write to organizations.a2p_brand_sid is conditional on
 *     a2p_status != 'approved' — once a brand is approved we refuse to
 *     overwrite the sid even if the operator hits this route again
 *     (resubmission of an approved brand would orphan the campaign).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { z } from 'zod'
import { createBrand, type A2PBrandData } from '@/lib/telephony/a2p'
import type { Json } from '@/types/database'

const brandDataSchema = z.object({
  business_legal_name:           z.string().min(1).max(200),
  business_type:                 z.enum([
    'Sole Proprietorship', 'Partnership',
    'Limited Liability Corporation', 'Co-operative',
    'Non-profit Corporation', 'Corporation',
  ]),
  business_industry:             z.string().min(1).max(64),
  business_registration_id_type: z.enum(['EIN', 'DUNS', 'CCN', 'CBN']),
  business_registration_number:  z.string().min(1).max(64),
  business_regions_of_operation: z.string().min(1).max(64),
  website_url:                   z.string().url().max(500),
  rep_first_name:                z.string().min(1).max(80),
  rep_last_name:                 z.string().min(1).max(80),
  rep_email:                     z.string().email().max(200),
  rep_phone_number:              z.string().regex(/^\+[1-9]\d{6,14}$/),
  rep_job_position:              z.enum(['CEO', 'CFO', 'GeneralCounsel', 'Director', 'GM', 'VP', 'Manager', 'Other']),
  rep_business_title:            z.string().min(1).max(120),
  address_street:                z.string().min(1).max(200),
  address_city:                  z.string().min(1).max(120),
  address_region:                z.string().min(1).max(120),
  address_postal_code:           z.string().min(1).max(20),
  address_iso_country:           z.string().length(2),
  stock_exchange:                z.string().max(80).optional(),
  stock_ticker:                  z.string().max(20).optional(),
}).strict()

const bodySchema = z.object({
  organization_id: z.string().uuid(),
  brand_data:      brandDataSchema,
}).strict()

export async function POST(req: NextRequest) {
  // ── Super-admin gate (mirrors /api/admin/accounts/[id] convention).
  // Note: super_admin is NEVER checked via requireRole() — that helper
  // only covers org-level roles. Every admin route fetches
  // profile.is_super_admin via supabaseAdmin manually. ──
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

  const { organization_id, brand_data } = parsed.data

  // Confirm the org exists + we're not re-registering an already-
  // approved brand. Refusing on already-approved keeps M7's billing
  // sources of truth clean — the org's campaign_sid is bound to a
  // specific brand_sid, and orphaning the campaign would break SMS
  // delivery on the next tick.
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, a2p_status, a2p_brand_sid')
    .eq('id', organization_id)
    .single()
  if (orgErr || !org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }
  if (org.a2p_status === 'approved') {
    return NextResponse.json({
      error: 'A2P brand already approved for this organization. Refusing to overwrite — escalate to engineering if the existing brand needs to be revoked.',
    }, { status: 409 })
  }

  // ── Enqueue the durable retry row BEFORE the synchronous Twilio
  // call. If the queue insert fails (e.g. duplicate active step) we
  // bail with 409 and the operator can resolve. If Twilio fails after
  // the queue insert succeeds, M5's runner picks the row up and
  // retries with exponential backoff. ──
  const { data: jobRow, error: jobErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .insert({
      organization_id,
      step:    'a2p_brand_register',
      status:  'in_progress',
      payload: brand_data as unknown as Json,
    })
    .select('id')
    .single()
  if (jobErr) {
    // 23505 is the partial-unique-index telling us a brand-register
    // job is already pending/in_progress/succeeded for this org.
    if (jobErr.code === '23505') {
      return NextResponse.json({
        error: 'A brand registration is already in flight for this organization. Wait for it to complete or mark it failed in the admin dashboard.',
      }, { status: 409 })
    }
    return NextResponse.json({ error: jobErr.message }, { status: 500 })
  }

  // ── Synchronous Twilio call. Wrapped in try so a Twilio failure
  // flips the job row to failed (with last_error captured) instead
  // of leaving it stuck at in_progress. The M5 runner re-tries
  // failed rows on the next tick. ──
  let brandSid: string
  let profileSid: string
  try {
    const result = await createBrand({ brandData: brand_data as A2PBrandData })
    brandSid   = result.brand_sid
    profileSid = result.profile_sid
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'createBrand failed'
    await supabaseAdmin
      .from('provisioning_jobs')
      .update({ status: 'failed', last_error: msg, attempts: 1 })
      .eq('id', jobRow.id)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Stamp the org. We also persist the profile sid + the full payload
  // to a2p_brand_data so a later resubmission can reuse the CP
  // without re-collecting. CAS guard: if a parallel call already
  // approved this brand, refuse to overwrite. (Approved was already
  // checked above; this is belt-and-suspenders.)
  const { error: orgUpdErr } = await supabaseAdmin
    .from('organizations')
    .update({
      a2p_brand_sid:          brandSid,
      a2p_status:             'pending',
      a2p_status_updated_at:  new Date().toISOString(),
      a2p_brand_data: {
        ...brand_data,
        _profile_sid: profileSid,
      },
    })
    .eq('id', organization_id)
    .neq('a2p_status', 'approved')
  if (orgUpdErr) {
    // Job row already succeeded at Twilio side — leave it succeeded
    // so the operator can pick up the brand sid from logs and apply
    // manually rather than losing the sid entirely.
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
    ok:               true,
    brand_sid:        brandSid,
    profile_sid:      profileSid,
    a2p_status:       'pending',
  })
}
