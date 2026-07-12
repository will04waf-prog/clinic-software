/**
 * M5 — Step handlers for the provisioning runner.
 *
 * Each handler is `async (job) => StepResult | throws`. The cron at
 * /api/cron/provisioning calls claim() on the queue, dispatches each
 * claimed row through STEP_HANDLERS[job.step], and routes the result:
 *
 *   - StepOk           → queue.complete(); optionally enqueue next step
 *   - StepDeferred     → queue.reschedule() — re-pending, no attempt
 *                        burned (used when an EXTERNAL state needs to
 *                        flip before we can proceed).
 *   - Thrown Error     → queue.fail({retryable:true}). Backoff is
 *                        attempts*30s; exhausts to status='failed'
 *                        after MAX_ATTEMPTS (see queue.ts).
 *
 * ─────────────────────────────────────────────────────────────────
 * STEP TAXONOMY (canonical — must match M1 migration comment + M3
 * onboarding PROVISIONING_STEPS + this file's STEP_HANDLERS)
 * ─────────────────────────────────────────────────────────────────
 *   buy_twilio_number       → Twilio IncomingPhoneNumbers POST; stamps
 *                             organizations.twilio_phone_number +
 *                             twilio_phone_sid + phone_number_purchased_at.
 *                             Enqueues register_vapi_phone on success.
 *
 *   register_vapi_phone     → Vapi POST /phone-number bound to the
 *                             org's inbound assistant; stamps
 *                             organizations.vapi_phone_number_id. If
 *                             the org row carries a2p_brand_data,
 *                             enqueues register_a2p_brand next.
 *
 *   register_a2p_brand      → TrustHub BrandRegistrations create; stamps
 *                             organizations.a2p_brand_sid + a2p_status =
 *                             'pending' + a2p_status_updated_at. Also
 *                             stashes profile_sid back into
 *                             a2p_brand_data so a retry can re-use it.
 *                             Does NOT auto-enqueue campaign — the
 *                             campaign step needs a MessagingService
 *                             SID the operator stamps manually first.
 *
 *   register_a2p_campaign   → READS organizations.a2p_status; if not
 *                             'approved' yet, returns { deferred:true }
 *                             — the queue resets the row to pending
 *                             without burning an attempt. Once approved
 *                             AND organizations.a2p_messaging_service_sid
 *                             is stamped, calls a2p.createCampaign and
 *                             stamps organizations.a2p_campaign_sid.
 *
 *   set_cnam                → Placeholder for outbound caller-ID name.
 *                             Returns success immediately; a real
 *                             implementation lands in a later sweep.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { enqueue, type ProvisioningJob } from './queue'
import {
  purchaseNumber,
  TwilioApiError,
  type PurchasedNumber,
} from '@/lib/telephony/twilio-numbers'
import {
  registerNumber as registerVapiNumber,
  VapiApiError,
  type VapiPhoneNumberResource,
} from '@/lib/telephony/vapi-phone-numbers'
import {
  createBrand,
  createCampaign,
  type A2PBrandData,
} from '@/lib/telephony/a2p'

export type StepName =
  | 'buy_twilio_number'
  | 'register_vapi_phone'
  | 'register_a2p_brand'
  | 'register_a2p_campaign'
  | 'set_cnam'

export interface StepOk {
  status: 'ok'
  payload?: Record<string, unknown>
  /** Optional next-step to enqueue on success. */
  enqueueNext?: {
    step:    StepName
    payload?: Record<string, unknown>
  }
}

export interface StepDeferred {
  status: 'deferred'
  reason: string
}

export type StepResult = StepOk | StepDeferred

export type StepHandler = (job: ProvisioningJob) => Promise<StepResult>

// ──────────────────────────────────────────────────────────────────
// buy_twilio_number
// ──────────────────────────────────────────────────────────────────

interface BuyPayload {
  e164?:         string
  friendlyName?: string
}

const stepBuyTwilioNumber: StepHandler = async (job) => {
  const payload = (job.payload ?? {}) as BuyPayload
  const e164 = payload.e164
  if (!e164) {
    // Non-retryable — the payload is what the M2 /api/admin/numbers/provision
    // route wrote, so a missing e164 is a caller bug, not transient.
    throw new Error(`buy_twilio_number: missing e164 on job ${job.id}`)
  }

  // Idempotency: Twilio's POST /IncomingPhoneNumbers returns the
  // existing row if we already own the number, so a retry from a stuck
  // job does NOT double-charge. purchaseNumber surfaces { sid, e164 }
  // identically on first-buy vs already-owned.
  let result: PurchasedNumber
  try {
    result = await purchaseNumber({
      e164,
      friendlyName: payload.friendlyName,
    })
  } catch (err) {
    if (err instanceof TwilioApiError) {
      throw new Error(`buy_twilio_number: twilio ${err.code ?? '?'}: ${err.message}`)
    }
    throw err
  }

  const { error: updErr } = await supabaseAdmin
    .from('organizations')
    .update({
      twilio_phone_number:       result.e164,
      twilio_phone_sid:          result.sid,
      phone_number_purchased_at: new Date().toISOString(),
    })
    .eq('id', job.organization_id)
  if (updErr) {
    throw new Error(`buy_twilio_number: org update failed: ${updErr.message}`)
  }

  return {
    status:      'ok',
    payload:     { twilio_sid: result.sid, e164: result.e164 },
    enqueueNext: { step: 'register_vapi_phone' },
  }
}

// ──────────────────────────────────────────────────────────────────
// register_vapi_phone
// ──────────────────────────────────────────────────────────────────

const stepRegisterVapiPhone: StepHandler = async (job) => {
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('name, twilio_phone_number, call_agent_assistant_id, a2p_brand_data, vapi_phone_number_id')
    .eq('id', job.organization_id)
    .maybeSingle()
  if (orgErr || !org) {
    throw new Error(`register_vapi_phone: org lookup failed: ${orgErr?.message ?? 'not found'}`)
  }

  // Idempotent re-run: if the Vapi resource is already attached, treat
  // as success and continue the chain. Throwing here would surface as
  // a real failure in the dashboard for what is actually the happy
  // path of "we re-enqueued after success."
  if (org.vapi_phone_number_id) {
    const hasBrandData = org.a2p_brand_data !== null && org.a2p_brand_data !== undefined
    const ok: StepOk = {
      status:  'ok',
      payload: { vapi_phone_number_id: org.vapi_phone_number_id, idempotent: true },
    }
    if (hasBrandData) ok.enqueueNext = { step: 'register_a2p_brand' }
    return ok
  }

  if (!org.twilio_phone_number) {
    throw new Error(`register_vapi_phone: org ${job.organization_id} has no twilio_phone_number; run buy_twilio_number first`)
  }
  if (!org.call_agent_assistant_id) {
    throw new Error(`register_vapi_phone: org ${job.organization_id} has no call_agent_assistant_id; run scripts/seed-vapi-assistant.ts`)
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken  = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    throw new Error('register_vapi_phone: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN required in env')
  }

  let result: VapiPhoneNumberResource
  try {
    result = await registerVapiNumber({
      twilioPhoneNumber: org.twilio_phone_number,
      twilioAccountSid:  accountSid,
      twilioAuthToken:   authToken,
      assistantId:       org.call_agent_assistant_id,
      name:              `${org.name ?? 'Clinic'} — primary line`,
    })
  } catch (err) {
    if (err instanceof VapiApiError) {
      throw new Error(`register_vapi_phone: vapi ${err.status ?? '?'}: ${err.message}`)
    }
    throw err
  }

  const { error: updErr } = await supabaseAdmin
    .from('organizations')
    .update({ vapi_phone_number_id: result.id })
    .eq('id', job.organization_id)
  if (updErr) {
    throw new Error(`register_vapi_phone: org update failed: ${updErr.message}`)
  }

  const hasBrandData = org.a2p_brand_data !== null && org.a2p_brand_data !== undefined
  const ok: StepOk = {
    status:  'ok',
    payload: { vapi_phone_number_id: result.id },
  }
  if (hasBrandData) ok.enqueueNext = { step: 'register_a2p_brand' }
  return ok
}

// ──────────────────────────────────────────────────────────────────
// register_a2p_brand
// ──────────────────────────────────────────────────────────────────

const stepRegisterA2pBrand: StepHandler = async (job) => {
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('a2p_brand_data, a2p_brand_sid')
    .eq('id', job.organization_id)
    .maybeSingle()
  if (orgErr || !org) {
    throw new Error(`register_a2p_brand: org lookup failed: ${orgErr?.message ?? 'not found'}`)
  }

  // Idempotency: brand already created → success, no auto-enqueue
  // (campaign step requires a MessagingService SID the operator
  // stamps manually first; runbook covers this).
  if (org.a2p_brand_sid) {
    return {
      status:  'ok',
      payload: { brand_sid: org.a2p_brand_sid, idempotent: true },
    }
  }

  const brandData = org.a2p_brand_data as A2PBrandData | null
  if (!brandData) {
    throw new Error(`register_a2p_brand: org ${job.organization_id} has no a2p_brand_data; require the M4 onboarding form first`)
  }

  // Retry support: a prior partial run may have already minted a
  // CustomerProfile but failed at the Brand step. Stash _profile_sid
  // back on brand_data and pull it back on retry to skip the
  // profile-creation re-mint.
  const existingProfileSid = (brandData as unknown as Record<string, unknown>)._profile_sid as string | undefined

  const result = await createBrand({
    brandData,
    profileSid: existingProfileSid,
  })

  // Stamp brand_sid + transition a2p_status to 'pending'. ALSO write
  // back profile_sid so a future retry skips CustomerProfile creation.
  const nextBrandData = {
    ...(brandData as unknown as Record<string, unknown>),
    _profile_sid: result.profile_sid,
  }
  const { error: updErr } = await supabaseAdmin
    .from('organizations')
    .update({
      a2p_brand_sid:         result.brand_sid,
      a2p_brand_data:        nextBrandData,
      a2p_status:            'pending',
      a2p_status_updated_at: new Date().toISOString(),
    })
    .eq('id', job.organization_id)
  if (updErr) {
    throw new Error(`register_a2p_brand: org update failed: ${updErr.message}`)
  }

  // Do NOT auto-enqueue the campaign step. It requires a
  // MessagingService SID we don't create automatically (the operator
  // wires Twilio MessagingService → phone number → campaign manually
  // for the MVP; runbook walks through it).
  return {
    status:  'ok',
    payload: { brand_sid: result.brand_sid, profile_sid: result.profile_sid },
  }
}

// ──────────────────────────────────────────────────────────────────
// register_a2p_campaign
// ──────────────────────────────────────────────────────────────────

interface CampaignPayload {
  messagingServiceSid?: string
  campaignVerticalEnum?: string
  messageSamples?: string[]
  description?: string
  usAppToPersonUsecase?: string
}

const stepRegisterA2pCampaign: StepHandler = async (job) => {
  const payload = (job.payload ?? {}) as CampaignPayload

  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('name, a2p_status, a2p_brand_sid, a2p_campaign_sid')
    .eq('id', job.organization_id)
    .maybeSingle()
  if (orgErr || !org) {
    throw new Error(`register_a2p_campaign: org lookup failed: ${orgErr?.message ?? 'not found'}`)
  }

  if (org.a2p_campaign_sid) {
    return { status: 'ok', payload: { campaign_sid: org.a2p_campaign_sid, idempotent: true } }
  }
  if (!org.a2p_brand_sid) {
    throw new Error(`register_a2p_campaign: org ${job.organization_id} has no a2p_brand_sid; register_a2p_brand must succeed first`)
  }
  if (org.a2p_status !== 'approved') {
    // Defer: M4's a2p-status poller flips org.a2p_status when Twilio
    // approves the brand. Until then, sit re-pending without burning
    // attempts. claim() picks us up next tick (every minute), we
    // re-read the local DB row and either proceed or defer again.
    return { status: 'deferred', reason: `a2p_status=${org.a2p_status} (waiting for approval)` }
  }

  // Campaign needs a MessagingService SID + message samples that the
  // operator must stage manually for the MVP. The payload is the
  // canonical place to pass them in — the super-admin dashboard's
  // "re-trigger" button can include these.
  if (!payload.messagingServiceSid) {
    throw new Error(`register_a2p_campaign: missing messagingServiceSid in payload; operator must create a Twilio MessagingService and pass its SID when enqueuing this step`)
  }
  if (!payload.messageSamples || payload.messageSamples.length < 2) {
    throw new Error(`register_a2p_campaign: missing messageSamples in payload; at least 2 sample SMS bodies required for TCR review`)
  }

  const result = await createCampaign({
    brandSid:             org.a2p_brand_sid,
    messagingServiceSid:  payload.messagingServiceSid,
    campaignVerticalEnum: payload.campaignVerticalEnum ?? 'HEALTHCARE',
    messageSamples:       payload.messageSamples,
    description:          payload.description ?? `Appointment reminders and patient confirmations for ${org.name ?? 'the clinic'}.`,
    usAppToPersonUsecase: payload.usAppToPersonUsecase ?? 'ACCOUNT_NOTIFICATION',
  })

  const { error: updErr } = await supabaseAdmin
    .from('organizations')
    .update({
      a2p_campaign_sid:      result.campaign_sid,
      a2p_status_updated_at: new Date().toISOString(),
    })
    .eq('id', job.organization_id)
  if (updErr) {
    throw new Error(`register_a2p_campaign: org update failed: ${updErr.message}`)
  }

  return { status: 'ok', payload: { campaign_sid: result.campaign_sid } }
}

// ──────────────────────────────────────────────────────────────────
// set_cnam (placeholder)
// ──────────────────────────────────────────────────────────────────

const stepSetCnam: StepHandler = async (job) => {
  // Outbound caller-ID name registration. Twilio CNAM updates take
  // 24-72h to propagate carriers and require a separate CNAM-paid
  // service contract. NOT implemented yet: rather than record a false
  // success, we mark the payload skipped:'not_implemented' and log it
  // so job history doesn't claim CNAM was actually set. The type still
  // requires 'ok' so the queue doesn't retry a step we intend to skip;
  // a real implementation lands in a later sweep.
  console.info(
    `[provisioning] set_cnam skipped (not_implemented) for job ${job.id} org ${job.organization_id}`,
  )
  return { status: 'ok', payload: { skipped: 'not_implemented' } }
}

// ──────────────────────────────────────────────────────────────────
// Handler registry
// ──────────────────────────────────────────────────────────────────

export const STEP_HANDLERS: Record<StepName, StepHandler> = {
  buy_twilio_number:     stepBuyTwilioNumber,
  register_vapi_phone:   stepRegisterVapiPhone,
  register_a2p_brand:    stepRegisterA2pBrand,
  register_a2p_campaign: stepRegisterA2pCampaign,
  set_cnam:              stepSetCnam,
}

// Re-export enqueue for callers that walk the dependency map (e.g.
// the M3 onboarding form starts the chain by enqueueing
// buy_twilio_number).
export { enqueue }
