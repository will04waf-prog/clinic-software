/**
 * POST /api/cron/voice-reminders — Phase 5 W2 outbound AI reminders.
 *
 * Hourly cadence (vercel.json). Finds consultations scheduled
 * `voice_reminder_lead_hours` from now (default 24h, clamped to
 * [2,72] by the org-level CHECK) and places an outbound Vapi call
 * via the per-clinic reminder assistant. The bot then runs the
 * reminder flow defined in src/voice/prompts/reminder.md and the
 * call-end webhook updates voice_reminder_status to the terminal
 * disposition.
 *
 * Why a dedicated route instead of folding into the existing
 * /api/cron fan-out:
 *   1. Hourly vs. minutely cadence. The reminder window is
 *      lead_hours ± 30min — a wider window than the SMS reminders
 *      use, so a 1-minute tick is over-sampling. Vercel cron
 *      doesn't let us request a sub-cadence inside a fan-out
 *      handler, so a separate route + separate schedule is the
 *      simplest expression.
 *   2. Cost. Each tick fires real outbound calls. We want to keep
 *      the firing rate as predictable as possible during the
 *      pre-launch period, and a separate route is easier to pause
 *      (delete the vercel.json entry) without touching the
 *      every-minute reminder/automation/hold-sweep pipeline.
 *
 * Idempotency layers (mirror src/lib/consultation-reminders.ts):
 *   - withCronLock('voice_reminders', 300) — prevents tick overlap
 *     across Vercel's pooled connections.
 *   - Per-row CAS UPDATE: every flip from 'pending' to 'sent' /
 *     'skipped' includes .eq('voice_reminder_status', 'pending')
 *     so a concurrent tick that sneaks past the lock can't
 *     double-call the same patient.
 *   - The Vapi REST call itself has no idempotency key (Vapi
 *     doesn't expose one); the lock + CAS pair is the dedupe
 *     story. Acceptable today because the lock TTL (5min) > the
 *     full cron tick wall time and we'll converge to row-level
 *     atomic claim alongside the SMS-reminder convergence.
 *
 * Gating chain (mirrors sendConsultationSms's 5-guard pattern):
 *   - org.voice_reminder_enabled === true       (master toggle)
 *   - org.call_agent_enabled === true           (assistant is live)
 *   - org.call_agent_baa_attested_at != null    (HIPAA gate)
 *   - org.call_agent_reminder_assistant_id      (seed script ran)
 *   - contact.phone present                     (we have a number)
 *   - contact.opted_out_sms !== true            (reuse SMS opt-out
 *                                                as voice opt-out
 *                                                proxy — TCPA-safer
 *                                                than re-asking)
 *   - isVapiOutboundConfigured()                (env vars set)
 *
 * Any guard failure flips voice_reminder_status to 'skipped' so
 * the next tick doesn't re-try the same row. The single exception
 * is when the org has no reminder assistant id — that's a
 * provisioning issue, NOT a per-row policy decision, so we leave
 * voice_reminder_status='pending' on those rows and the operator
 * sees them flip to 'sent' the moment the seed script runs.
 */

import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron/require-cron-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { withCronLock } from '@/lib/cron-locks'
import { placeOutboundCall, isVapiOutboundConfigured } from '@/lib/voice-agent/vapi-outbound'
import { blockedReason } from '@/lib/billing/org-access'
import { alertOperator } from '@/lib/ops-alert'

interface ContactRow {
  id:             string
  first_name:     string | null
  phone:          string | null
  opted_out_sms:  boolean | null
}

interface ConsultationRow {
  id:                  string
  scheduled_at:        string
  contact_id:          string
  contact:             ContactRow | null
}

interface OrgRow {
  id:                                string
  name:                              string
  timezone:                          string | null
  voice_reminder_enabled:            boolean
  voice_reminder_lead_hours:         number
  call_agent_enabled:                boolean
  call_agent_baa_attested_at:        string | null
  call_agent_reminder_assistant_id:  string | null
  twilio_phone_number:               string | null
  plan_status:                       string | null
  trial_ends_at:                     string | null
  // M1: per-org Vapi phone-number resource id. Replaces the global
  // VAPI_PHONE_NUMBER_ID env var that gated the whole platform.
  // Orgs where this is null are still provisioning — counted as
  // 'no_phone_number_orgs' in the outcome so the operator can see
  // the gap.
  vapi_phone_number_id:              string | null
}

interface JobOutcome {
  ok:        boolean
  attempted: number
  sent:      number
  skipped:   number
  errors:    number
  no_assistant_orgs:     number
  // M1: orgs with reminder + agent enabled + BAA attested + assistant
  // seeded, but no vapi_phone_number_id yet. These are the orgs the
  // M5 provisioning runner is still working through — surfacing the
  // count separately from no_assistant_orgs makes the difference
  // diagnosable from the cron response alone.
  no_phone_number_orgs:  number
}

export async function sendVoiceReminders(): Promise<JobOutcome> {
  const outcome: JobOutcome = {
    ok: true, attempted: 0, sent: 0, skipped: 0, errors: 0,
    no_assistant_orgs: 0, no_phone_number_orgs: 0,
  }

  const wrapped = await withCronLock('voice_reminders', 300, async () => {
    const now = Date.now()

    // Fetch every org that has outbound reminders on. We page
    // through orgs and run their per-org window query in parallel —
    // a single global query would be cleaner if lead_hours were
    // fixed, but the per-org clamp means each org has its own
    // window bounds.
    const { data: orgs, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select(`
        id, name, timezone,
        voice_reminder_enabled, voice_reminder_lead_hours,
        call_agent_enabled, call_agent_baa_attested_at,
        call_agent_reminder_assistant_id, twilio_phone_number,
        vapi_phone_number_id, plan_status, trial_ends_at
      `)
      .eq('voice_reminder_enabled', true)
      .eq('call_agent_enabled', true)
      .not('call_agent_baa_attested_at', 'is', null)
    if (orgErr) {
      console.error('[voice-reminders] org fetch failed:', orgErr.message)
      outcome.ok = false
      return outcome
    }

    // Plan lockout: outbound reminder calls are the most expensive send
    // in the product (billable Vapi + Twilio minutes) — never place them
    // for canceled/suspended/lapsed-trial orgs.
    const eligibleOrgs = ((orgs ?? []) as OrgRow[]).filter((o) => {
      const lock = blockedReason(o.plan_status, o.trial_ends_at)
      if (lock) console.log(`[voice-reminders] org ${o.id} plan ${lock}, skipping`)
      return !lock
    })

    if (!isVapiOutboundConfigured()) {
      // Bail loudly. The cron should not silently no-op on missing
      // env in production — a misconfigured deploy is the kind of
      // thing that goes undetected for weeks if we just skip.
      // Note: as of M1 this is purely an API-key check — the
      // phoneNumberId is per-org and read off the row below.
      console.warn('[voice-reminders] VAPI_API_KEY not configured — skipping tick')
      outcome.ok = false
      return outcome
    }

    await Promise.all(eligibleOrgs.map(async (org) => {
      if (!org.call_agent_reminder_assistant_id) {
        // Provisioning gap — leave rows pending so they'll fire on
        // the next tick after the seed script runs. Surface in the
        // cron response so the operator can see the gap.
        console.warn(`[voice-reminders] org ${org.id} has no call_agent_reminder_assistant_id — run scripts/seed-vapi-reminder-assistant.ts ${org.id}`)
        outcome.no_assistant_orgs += 1
        return
      }

      if (!org.vapi_phone_number_id) {
        // M1: per-org Vapi phone-number resource isn't provisioned
        // yet. Same shape as the missing-assistant branch: leave
        // rows pending, surface the count, let the M5 cron complete
        // provisioning. We deliberately do NOT mark these rows
        // 'skipped' — that would permanently strand them; we want
        // the next tick post-provisioning to fire normally.
        console.warn(`[voice-reminders] org ${org.id} has no vapi_phone_number_id — run scripts/provision-clinic-phone.ts or wait for the provisioning cron`)
        outcome.no_phone_number_orgs += 1
        return
      }

      // Per-org window: lead_hours ± 30min around now. The 30-min
      // half-window matches the hourly cron cadence — every
      // eligible consultation is hit exactly once because adjacent
      // 1-hour windows don't overlap. The bounds are inclusive on
      // both sides only because the .gte / .lte are inclusive and
      // a consultation landing precisely on a tick boundary is a
      // measure-zero event in practice.
      const lead = org.voice_reminder_lead_hours
      const windowStart = new Date(now + (lead - 0.5) * 3600_000).toISOString()
      const windowEnd   = new Date(now + (lead + 0.5) * 3600_000).toISOString()

      const { data: consults, error: consErr } = await supabaseAdmin
        .from('consultations')
        .select(`
          id, scheduled_at, contact_id,
          contact:contacts!consultations_contact_id_fkey(id, first_name, phone, opted_out_sms)
        `)
        .eq('organization_id', org.id)
        .in('status', ['scheduled', 'confirmed'])
        .eq('voice_reminder_status', 'pending')
        .gte('scheduled_at', windowStart)
        .lte('scheduled_at', windowEnd)
      if (consErr) {
        console.error(`[voice-reminders] consultation fetch failed for org ${org.id}:`, consErr.message)
        outcome.errors += 1
        return
      }

      // Supabase returns contact as either an object or an array
      // depending on the relationship metadata. Normalize so the
      // per-row branches below don't have to branch on shape.
      const rows: ConsultationRow[] = (consults ?? []).map((r: any) => ({
        id:           r.id,
        scheduled_at: r.scheduled_at,
        contact_id:   r.contact_id,
        contact:      Array.isArray(r.contact) ? (r.contact[0] ?? null) : (r.contact ?? null),
      }))

      for (const row of rows) {
        outcome.attempted += 1

        const contact = row.contact
        const skipReason = (() => {
          if (!contact)              return 'no_contact'
          if (!contact.phone)        return 'no_phone'
          if (contact.opted_out_sms) return 'opted_out'
          return null
        })()

        if (skipReason) {
          // CAS skip stamp — only flips if the row is still
          // 'pending'. If a concurrent tick already grabbed this
          // row the UPDATE is a no-op.
          await supabaseAdmin
            .from('consultations')
            .update({
              voice_reminder_status:  'skipped',
              voice_reminder_sent_at: new Date().toISOString(),
            })
            .eq('id', row.id)
            .eq('voice_reminder_status', 'pending')
          outcome.skipped += 1
          continue
        }

        // Pre-render the spoken time + consultation_id for the
        // assistant. Vapi `metadata` is forwarded to the call-end
        // webhook but is NOT injected into the assistant's
        // conversation context — only `assistantOverrides.variableValues`
        // are template-substituted into the system prompt. Without
        // these, the patient hears literal "{{spoken_time}}" and the
        // LLM has no consultation_id to pass to confirm_appointment.
        const tz = org.timezone || 'America/New_York'
        const spokenTime = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          weekday:  'long',
          month:    'long',
          day:      'numeric',
          hour:     'numeric',
          minute:   '2-digit',
          hour12:   true,
        }).format(new Date(row.scheduled_at))

        try {
          // Metadata is forwarded verbatim to the call-end webhook
          // — the webhook resolves consultation_id back to this
          // row to write the final disposition without a recent-
          // rows scan.
          const result = await placeOutboundCall({
            assistantId:   org.call_agent_reminder_assistant_id!,
            // M1: per-org Vapi phone-number resource (was global env).
            // The null-guard above means this is always defined here.
            phoneNumberId: org.vapi_phone_number_id!,
            to:            contact!.phone!,
            customerName:  contact!.first_name ?? null,
            metadata: {
              consultation_id: row.id,
              organization_id: org.id,
            },
            assistantOverrides: {
              variableValues: {
                clinic_name:         org.name,
                patient_first_name:  contact!.first_name ?? 'there',
                // The LLM reads consultation_id from here and passes
                // it to confirm_appointment / reschedule / cancel —
                // metadata is webhook-only, NOT in conversation context.
                consultation_id:     row.id,
                spoken_time:         spokenTime,
              },
            },
          })

          if (!result) {
            // placeOutboundCall returned null — unparseable phone
            // or env gap. Mark skipped so we don't retry next tick.
            await supabaseAdmin
              .from('consultations')
              .update({
                voice_reminder_status:  'skipped',
                voice_reminder_sent_at: new Date().toISOString(),
              })
              .eq('id', row.id)
              .eq('voice_reminder_status', 'pending')
            outcome.skipped += 1
            continue
          }

          // CAS flip pending → sent. Concurrent tick races no-op
          // here; the Vapi call has already been placed but the
          // row was already marked by the other tick — accept the
          // small cost of a duplicate Vapi call rather than a race
          // that leaves the row pending and re-fires next tick.
          // (In practice the cron lock prevents this entirely; the
          // CAS is belt-and-suspenders.)
          await supabaseAdmin
            .from('consultations')
            .update({
              voice_reminder_status:   'sent',
              voice_reminder_sent_at:  new Date().toISOString(),
              voice_reminder_call_sid: result.provider_id,
            })
            .eq('id', row.id)
            .eq('voice_reminder_status', 'pending')
          outcome.sent += 1
        } catch {
          // PHI-safe error path — never interpolate the error,
          // which can contain the destination phone. Leave the row
          // 'pending' so the next tick retries: a transient Vapi
          // 5xx shouldn't permanently strand a reminder. Cron-lock
          // TTL (5min) prevents a retry storm within the same
          // tick wall-time.
          console.error(`[voice-reminders] vapi placeOutboundCall threw for consultation ${row.id}`)
          outcome.errors += 1
        }
      }
    }))

    return outcome
  })

  if (wrapped.skipped) {
    return { ...outcome, ok: true }
  }
  return wrapped.result ?? outcome
}

export async function POST(request: Request) {
  const denied = requireCronAuth(request)
  if (denied) return denied

  const result = await sendVoiceReminders()
  if (!result.ok) {
    // Billable patient calls — the operator must hear about failures.
    await alertOperator({
      key: 'cron-voice-reminders',
      subject: 'voice-reminders cron reported failure',
      body: `Outcome: ${JSON.stringify(result)}\nHourly cron — repeats at most hourly while failing.`,
    })
  }
  return NextResponse.json({
    ok: result.ok,
    ran_at: new Date().toISOString(),
    voice_reminders: result,
  }, { status: result.ok ? 200 : 500 })
}

// Manual trigger during dev. Matches the existing /api/cron pattern.
export async function GET(request: Request) {
  return POST(request)
}
