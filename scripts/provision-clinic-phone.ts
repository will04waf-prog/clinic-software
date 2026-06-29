/**
 * M1 — Manual rescue script for clinic phone provisioning.
 *
 * Usage:
 *
 *   npx tsx scripts/provision-clinic-phone.ts <org-id> <e164>
 *
 * What it does (one-shot, manual; the M5 cron will do the same thing
 * automatically for new onboards):
 *
 *   1. Validates the org exists and has a call_agent_assistant_id
 *      (we need an assistant to bind the Vapi phone resource to).
 *   2. Verifies the Twilio number is already purchased and live on
 *      THIS account — looks the number up via the Twilio REST API
 *      and refuses to proceed if it's not in the IncomingPhoneNumbers
 *      list. We do NOT buy the number from this script — buying is
 *      reserved for the M5 step handlers because it has billing
 *      consequences and should be confirmed by the operator first.
 *   3. POSTs https://api.vapi.ai/phone-number with:
 *        { provider:'twilio', twilioAccountSid, twilioAuthToken,
 *          number:<e164>, name:<org name>, assistantId:<inbound assistant> }
 *      Catches Vapi 409 ("already exists") and recovers via
 *      GET /phone-number?number=<e164> — Vapi is NOT idempotent on
 *      this endpoint so the dup-recovery is mandatory.
 *   4. UPDATEs organizations SET twilio_phone_number, twilio_phone_sid,
 *      vapi_phone_number_id, phone_number_purchased_at.
 *
 * Idempotency contract — refuses loudly if vapi_phone_number_id is
 * already populated, so a re-run of this script cannot create a
 * duplicate Vapi resource. If the operator NEEDS to re-attach (e.g.
 * we deleted the Vapi resource manually), they must clear the column
 * first. The cron's step handler will share this guard.
 *
 * Env required:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN — for the number lookup + Vapi auth.
 *   VAPI_API_KEY                          — for the POST /phone-number call.
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — for the DB write.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// dotenv pull-in matches the seed scripts so a repo-root invocation
// just works without explicit env exports.
for (const path of ['.env.local', '.env']) {
  const full = resolve(process.cwd(), path)
  if (existsSync(full)) loadEnv({ path: full })
}

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN
const VAPI_API_KEY       = process.env.VAPI_API_KEY
const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY

interface TwilioIncomingPhoneNumber {
  sid:           string
  phone_number:  string
  friendly_name: string | null
}

async function findTwilioNumber(e164: string): Promise<TwilioIncomingPhoneNumber | null> {
  // Twilio REST: GET /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers.json?PhoneNumber=<e164>
  // returns 0..1 matches when filtered by exact phone number. Auth is
  // HTTP Basic with AccountSid:AuthToken — same creds as the SDK.
  const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`)
  url.searchParams.set('PhoneNumber', e164)
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
  const res = await fetch(url.toString(), { headers: { Authorization: `Basic ${auth}` } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Twilio IncomingPhoneNumbers lookup failed: ${res.status} ${text}`)
  }
  const json = await res.json() as { incoming_phone_numbers?: TwilioIncomingPhoneNumber[] }
  const list = json.incoming_phone_numbers ?? []
  return list[0] ?? null
}

interface VapiPhoneNumberResource {
  id:     string
  number: string
}

async function registerVapiPhoneNumber(args: {
  e164:        string
  orgName:     string
  assistantId: string
}): Promise<VapiPhoneNumberResource> {
  const body = {
    provider:         'twilio',
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken:  TWILIO_AUTH_TOKEN,
    number:           args.e164,
    name:             `${args.orgName} — primary line`,
    assistantId:      args.assistantId,
  }
  const res = await fetch('https://api.vapi.ai/phone-number', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (res.ok) {
    const json = await res.json() as VapiPhoneNumberResource
    if (!json.id) throw new Error('Vapi 2xx but response missing id')
    return json
  }

  // Vapi returns 409 (or 400 with a duplicate-resource message) when
  // the number is already attached. The endpoint is NOT idempotent —
  // we have to GET by number to recover the existing id.
  if (res.status === 409 || res.status === 400) {
    const text = await res.text().catch(() => '')
    console.warn(`[provision] Vapi returned ${res.status} on POST — attempting GET fallback. Body: ${text.slice(0, 200)}`)
    const lookupUrl = new URL('https://api.vapi.ai/phone-number')
    lookupUrl.searchParams.set('number', args.e164)
    const lookupRes = await fetch(lookupUrl.toString(), {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    })
    if (!lookupRes.ok) {
      throw new Error(`Vapi POST /phone-number returned ${res.status} and GET fallback also failed: ${lookupRes.status}`)
    }
    const list = await lookupRes.json() as VapiPhoneNumberResource[] | VapiPhoneNumberResource
    const match = Array.isArray(list)
      ? list.find(p => p.number === args.e164) ?? list[0]
      : list
    if (!match?.id) {
      throw new Error('Vapi POST /phone-number was 409 but GET fallback returned no matching id')
    }
    return match
  }

  const text = await res.text().catch(() => '')
  throw new Error(`Vapi POST /phone-number failed: ${res.status} ${text.slice(0, 400)}`)
}

async function main() {
  const orgId = process.argv[2]
  const e164  = process.argv[3]
  if (!orgId || !e164) {
    console.error('Usage: npx tsx scripts/provision-clinic-phone.ts <org-id> <e164>')
    process.exit(1)
  }
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) {
    console.error(`[provision] "${e164}" is not a valid E.164 number (e.g. +14155551234)`)
    process.exit(1)
  }
  for (const [name, val] of Object.entries({
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VAPI_API_KEY, SUPABASE_URL, SUPABASE_KEY,
  })) {
    if (!val) {
      console.error(`[provision] ${name} is required`)
      process.exit(1)
    }
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } })

  // ── Step 1: load + validate the org ───────────────────────────
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select(`
      id, name, slug,
      call_agent_assistant_id,
      vapi_phone_number_id,
      twilio_phone_sid,
      twilio_phone_number
    `)
    .eq('id', orgId)
    .single()

  if (orgErr || !org) {
    console.error(`[provision] could not find organization ${orgId}: ${orgErr?.message}`)
    process.exit(1)
  }

  if (!org.call_agent_assistant_id) {
    console.error(`[provision] org ${org.id} has no call_agent_assistant_id — run scripts/seed-vapi-assistant.ts first`)
    process.exit(1)
  }

  // Idempotency guard. The whole point of this script is to be safe
  // to re-run, but the script writes to columns Vapi pays attention
  // to — if vapi_phone_number_id is already set, a second run would
  // POST /phone-number AGAIN and either 409 (best case) or create a
  // duplicate resource (Vapi has been inconsistent here). Refuse
  // loudly and require the operator to clear the column first.
  if (org.vapi_phone_number_id) {
    console.error(`[provision] org ${org.id} already has vapi_phone_number_id=${org.vapi_phone_number_id}. Refusing to re-provision.`)
    console.error('[provision] If you really need to re-attach, clear the column first:')
    console.error(`[provision]   update organizations set vapi_phone_number_id=null, twilio_phone_sid=null where id='${org.id}';`)
    process.exit(1)
  }

  // ── Step 2: confirm Twilio owns the number ─────────────────────
  // We do NOT buy from this manual script — buying belongs to the
  // M5 step handler ('buy_twilio_number') which can update the
  // provisioning_jobs row + bill the right Stripe customer. This
  // script is purely the "wire the existing number through Vapi
  // and stamp the org row" rescue path.
  const twilioNumber = await findTwilioNumber(e164)
  if (!twilioNumber) {
    console.error(`[provision] Twilio account does not own ${e164}. Buy it first:`)
    console.error(`[provision]   In the Twilio console: Phone Numbers → Buy a Number, search for ${e164}, then re-run this script.`)
    process.exit(1)
  }
  console.log(`[provision] Twilio confirms ownership: ${twilioNumber.phone_number} (${twilioNumber.sid})`)

  // ── Step 3: register the number with Vapi ──────────────────────
  console.log(`[provision] Registering ${e164} with Vapi (assistant ${org.call_agent_assistant_id})…`)
  const vapiPhone = await registerVapiPhoneNumber({
    e164,
    orgName:     org.name,
    assistantId: org.call_agent_assistant_id,
  })
  console.log(`[provision] Vapi phone-number id: ${vapiPhone.id}`)

  // ── Step 4: write back to organizations ────────────────────────
  const { error: updErr } = await supabase
    .from('organizations')
    .update({
      twilio_phone_number:       e164,
      twilio_phone_sid:          twilioNumber.sid,
      vapi_phone_number_id:      vapiPhone.id,
      phone_number_purchased_at: new Date().toISOString(),
    })
    .eq('id', org.id)

  if (updErr) {
    console.error(`[provision] Vapi + Twilio are set up, but writing the org row failed: ${updErr.message}`)
    console.error('[provision] Manually run:')
    console.error(`  update organizations set twilio_phone_number='${e164}', twilio_phone_sid='${twilioNumber.sid}', vapi_phone_number_id='${vapiPhone.id}', phone_number_purchased_at=now() where id='${org.id}';`)
    process.exit(1)
  }

  // ── Step 5: record phone_number_rent usage_event ──────────────
  // Phase 5 M7. One-shot insert at provisioning time, idempotent via
  // source_ref='init:<orgid>' against the (org, kind, source_ref)
  // partial unique index. The M7 daily reporter reads this and emits
  // a Stripe meter event when STRIPE_PHONE_NUMBER_PRICE_ID is set.
  // Today (flag off) it's audit-only: the row sits in usage_events
  // with reported_to_stripe_at=NULL until billing is flipped on.
  //
  // We DO NOT block the script's success on this insert. The Twilio
  // + Vapi resources are already live by this point; an audit row
  // failure would force the operator to delete those resources to
  // re-run, which is the wrong trade-off. Log + continue.
  const { error: usageErr } = await supabase
    .from('usage_events')
    .upsert(
      {
        organization_id:      org.id,
        kind:                 'phone_number_rent',
        quantity:             1,
        billing_period_start: new Date().toISOString().slice(0, 8) + '01',
        billing_period_end: (() => {
          const now = new Date()
          const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
          return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`
        })(),
        source_ref:           `init:${org.id}`,
      },
      { onConflict: 'organization_id,kind,source_ref', ignoreDuplicates: true },
    )
  if (usageErr) {
    console.warn(`[provision] usage_events insert failed (non-fatal): ${usageErr.message}`)
  } else {
    console.log('[provision] Recorded phone_number_rent usage_event (audit-only until STRIPE_PHONE_NUMBER_PRICE_ID is set).')
  }

  console.log('[provision] Done.')
  console.log(`[provision]   org             ${org.id} (${org.name})`)
  console.log(`[provision]   phone           ${e164}`)
  console.log(`[provision]   twilio_sid      ${twilioNumber.sid}`)
  console.log(`[provision]   vapi_phone_id   ${vapiPhone.id}`)
  console.log('[provision] Next steps: turn on /settings/call-agent, attest BAA, and the voice-reminder cron will use this number.')
}

main().catch(err => {
  console.error('[provision] Unexpected error:', err)
  process.exit(1)
})
