/**
 * PHASE C3 — Founder-only tenant onboarding CLI (multi-vertical).
 *
 * One command that takes a tenant from nothing to "ready to forward":
 *
 *   1. organizations row  (vertical/language config + trial armed,
 *      mirroring /api/auth/signup exactly: auth user → org → owner
 *      profile → seed_default_stages RPC)
 *   2. Supabase auth user for the owner (no password; a recovery link
 *      is printed so the founder can hand them a set-password URL)
 *   3. Inbound Vapi assistant via the SAME seeding service the product
 *      uses (src/lib/voice-agent/seed-assistants.ts ensureInboundAssistant)
 *   4. A freshly bought LOCAL Twilio number (area code taken from the
 *      business's existing number) imported to Vapi and bound to the
 *      new assistant — reusing src/lib/telephony/twilio-numbers.ts +
 *      vapi-phone-numbers.ts, with the same 409-recovery contract as
 *      scripts/provision-clinic-phone.ts
 *   5. A printed go-live sheet: carrier conditional-forwarding codes
 *      (busy / no-answer) for the big-four US carriers + a 6-step
 *      test checklist
 *
 * SAFETY MODEL — DRY RUN IS THE DEFAULT. Without --live the script
 * performs ONLY read-only calls (a Supabase SELECT for the duplicate
 * check and a Twilio AvailablePhoneNumbers GET so it can show the
 * exact number it would buy) and prints every step it WOULD take.
 * Pass --live to actually create / buy / bind. Every live step is
 * recorded in a ledger; a mid-flight failure prints exactly what was
 * created so far and how to clean each piece up manually.
 *
 * Idempotency — if an organization with the same name already exists
 * (with or without an assistant / number), the script stops loudly
 * instead of duplicating. Re-pointing or re-provisioning an existing
 * org stays with the dedicated scripts (seed-vapi-assistant.ts,
 * provision-clinic-phone.ts).
 *
 * Usage:
 *
 *   npx tsx scripts/onboard-tenant.ts \
 *     --name "Rio Grande Plumbing" \
 *     --owner-cell +12025550177 \
 *     --owner-email maria@example.com \
 *     --owner-language es \
 *     --business-number +13015550123 \
 *     [--vertical trades]        medspa|trades|food|general (default: trades)
 *     [--bilingual]              force caller_languages {en,es} for an en owner
 *     [--area-code 301]          fallback when the business number is not +1
 *     [--owner-name "Maria G."]  profiles.full_name (default: "Owner")
 *     [--live]                   actually execute (default: dry run)
 *
 * Language rules: es owner → caller_languages {en,es} automatically;
 * en owner → {en} unless --bilingual. owner_language only governs
 * owner-facing output (summaries, alerts) — see vertical/config.ts.
 *
 * Env required (loaded from .env.local / .env like the sibling scripts):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *   VAPI_API_KEY (+ VAPI_WEBHOOK_SECRET, warned if missing)
 *   SEED_APP_URL / NEXT_PUBLIC_APP_URL — public app URL for tool
 *   callbacks; localhost values fall back to https://tarhunna.net
 *   (a Vapi assistant seeded against localhost is mute — see
 *   seed-assistants.ts resolveAppUrl).
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { slugify } from '../src/lib/utils'
// Type-only imports are erased at runtime, so they're safe before the
// dotenv load below; the VALUE imports of these modules are deferred
// (await import) inside main(), matching seed-vapi-assistant.ts.
import type { AvailablePhoneNumber } from '../src/lib/telephony/twilio-numbers'
import type { VapiPhoneNumberResource } from '../src/lib/telephony/vapi-phone-numbers'

// dotenv pull-in matches provision-clinic-phone.ts so a repo-root
// invocation just works without explicit env exports.
for (const path of ['.env.local', '.env']) {
  const full = resolve(process.cwd(), path)
  if (existsSync(full)) loadEnv({ path: full })
}

// ── Constants ─────────────────────────────────────────────────────

/** Vapi rejects assistant names longer than 40 chars. The seeding
 *  service names the assistant `${org.name} receptionist`, so the
 *  display name must leave room for the suffix — checked BEFORE
 *  anything is created. */
const VAPI_ASSISTANT_NAME_LIMIT = 40
const ASSISTANT_NAME_SUFFIX = ' receptionist'
const MAX_ORG_NAME_LEN = VAPI_ASSISTANT_NAME_LIMIT - ASSISTANT_NAME_SUFFIX.length // 27

const VERTICALS = ['medspa', 'trades', 'food', 'general'] as const
type VerticalArg = (typeof VERTICALS)[number]

const E164 = /^\+[1-9]\d{6,14}$/
/** Same 14-day window /api/auth/signup arms. */
const TRIAL_DAYS = 14

// ── CLI parsing (same style as spin-prospect-demo.ts) ─────────────

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`)
  if (i < 0) return undefined
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}

function argPresent(flag: string): boolean {
  return process.argv.includes(`--${flag}`)
}

interface Inputs {
  name:           string
  ownerCell:      string
  ownerEmail:     string
  ownerLanguage:  'en' | 'es'
  businessNumber: string
  vertical:       VerticalArg
  callerLanguages: string[]
  areaCode:       string
  ownerName:      string
  live:           boolean
}

function usage(): never {
  console.error(
    'Usage: npx tsx scripts/onboard-tenant.ts \\\n' +
    '  --name "Business Name" --owner-cell +1XXXXXXXXXX --owner-email a@b.com \\\n' +
    '  --owner-language en|es --business-number +1XXXXXXXXXX \\\n' +
    '  [--vertical medspa|trades|food|general] [--bilingual] [--area-code NPA] \\\n' +
    '  [--owner-name "Full Name"] [--live]',
  )
  process.exit(1)
}

function parseInputs(): Inputs {
  const name           = argValue('name')
  const ownerCell      = argValue('owner-cell')
  const ownerEmail     = argValue('owner-email')
  const ownerLanguage  = argValue('owner-language')
  const businessNumber = argValue('business-number')
  const vertical       = (argValue('vertical') ?? 'trades') as VerticalArg
  const live           = argPresent('live')

  if (!name || !ownerCell || !ownerEmail || !ownerLanguage || !businessNumber) usage()

  // ── Hard gate: Vapi's 40-char assistant-name limit. Checked before
  // ANY resource is created so a too-long name can never strand a
  // half-onboarded tenant.
  if (name.length > MAX_ORG_NAME_LEN) {
    console.error(
      `[onboard] "${name}" is ${name.length} chars — too long. ` +
      `Vapi caps assistant names at ${VAPI_ASSISTANT_NAME_LIMIT} chars and the assistant is named ` +
      `"<name>${ASSISTANT_NAME_SUFFIX}", so the display name must be ≤ ${MAX_ORG_NAME_LEN} chars. ` +
      'Re-run with a shorter display name (e.g. drop "LLC" / abbreviate). Nothing was created.',
    )
    process.exit(1)
  }

  if (ownerLanguage !== 'en' && ownerLanguage !== 'es') {
    console.error(`[onboard] --owner-language must be en or es (got "${ownerLanguage}")`)
    process.exit(1)
  }
  if (!(VERTICALS as readonly string[]).includes(vertical)) {
    console.error(`[onboard] --vertical must be one of ${VERTICALS.join('|')} (got "${vertical}")`)
    process.exit(1)
  }
  for (const [label, value] of [['--owner-cell', ownerCell], ['--business-number', businessNumber]] as const) {
    if (!E164.test(value)) {
      console.error(`[onboard] ${label} "${value}" is not valid E.164 (e.g. +13015551234)`)
      process.exit(1)
    }
  }
  if (!/^\S+@\S+\.\S+$/.test(ownerEmail)) {
    console.error(`[onboard] --owner-email "${ownerEmail}" does not look like an email address`)
    process.exit(1)
  }

  // es owner → bilingual line automatically (their customer base
  // calls in both); en owner stays English-only unless --bilingual.
  const callerLanguages = ownerLanguage === 'es' || argPresent('bilingual') ? ['en', 'es'] : ['en']

  // Area code for the LOCAL number search: the NPA of the number
  // customers already call, so the new Layla line looks local to
  // them. --area-code is the fallback for non-US business numbers.
  const npaMatch = businessNumber.match(/^\+1([2-9]\d{2})\d{7}$/)
  const areaCode = argValue('area-code') ?? npaMatch?.[1]
  if (!areaCode || !/^[2-9]\d{2}$/.test(areaCode)) {
    console.error(
      `[onboard] could not derive a US area code from ${businessNumber} — pass --area-code NPA (3 digits).`,
    )
    process.exit(1)
  }

  return {
    name,
    ownerCell,
    ownerEmail: ownerEmail.toLowerCase(),
    ownerLanguage,
    businessNumber,
    vertical,
    callerLanguages,
    areaCode,
    ownerName: argValue('owner-name') ?? 'Owner',
    live,
  }
}

// ── Cleanup ledger — every external step is recorded so a mid-flight
// failure prints exactly what exists and how to remove it. ──────────

interface LedgerEntry {
  what:    string
  cleanup: string
}

const ledger: LedgerEntry[] = []

function printLedger(): void {
  if (ledger.length === 0) {
    console.error('[onboard] Nothing was created before the failure — safe to just re-run.')
    return
  }
  console.error('\n[onboard] ── CREATED SO FAR (manual cleanup guide) ─────────────')
  for (const [i, entry] of ledger.entries()) {
    console.error(`[onboard] ${i + 1}. ${entry.what}`)
    console.error(`[onboard]    cleanup: ${entry.cleanup}`)
  }
  console.error('[onboard] Clean up in REVERSE order, then re-run the command.')
}

// ── Small helpers ─────────────────────────────────────────────────

/** 10-digit national form for carrier star codes (US carriers want
 *  the plain 10 digits, not +1). Non-+1 numbers pass through as
 *  full digits. */
function national10(e164: string): string {
  return e164.startsWith('+1') ? e164.slice(2) : e164.slice(1)
}

/** Public app URL for Vapi tool callbacks. seed-assistants refuses
 *  localhost (Vapi's cloud can't reach it), so unlike the sibling
 *  seed script we fall back to prod rather than erroring — this is a
 *  founder tool and prod is always the right target. */
function resolveOnboardAppUrl(): string {
  const raw = process.env.SEED_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'
  if (/localhost|127\.0\.0\.1/.test(raw)) {
    console.warn(`[onboard] app URL "${raw}" is localhost — using https://tarhunna.net for Vapi tool callbacks (override with SEED_APP_URL).`)
    return 'https://tarhunna.net'
  }
  return raw.replace(/\/$/, '')
}

/** Vapi GET /phone-number?number= recovery — same contract as
 *  provision-clinic-phone.ts: POST /phone-number is NOT idempotent,
 *  so a 409/400 must be recovered by looking the number up. */
async function lookupVapiNumberByE164(e164: string): Promise<VapiPhoneNumberResource> {
  const url = new URL('https://api.vapi.ai/phone-number')
  url.searchParams.set('number', e164)
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
  })
  if (!res.ok) {
    throw new Error(`Vapi GET /phone-number fallback failed: ${res.status}`)
  }
  const list = await res.json() as VapiPhoneNumberResource[] | VapiPhoneNumberResource
  const match = Array.isArray(list) ? list.find(p => p.number === e164) ?? list[0] : list
  if (!match?.id) {
    throw new Error('Vapi POST /phone-number conflicted but GET fallback returned no matching id')
  }
  return match
}

// ── Go-live sheet ─────────────────────────────────────────────────
//
// Carrier conditional-forwarding codes verified July 2026 against
// carrier docs + current carrier guides (Verizon community/support,
// AT&T feature-access-code PDF, T-Mobile support, US Cellular
// forwarding guides). Carriers occasionally change these — if a code
// fails, check the carrier's own support page first.

function printGoLiveSheet(args: {
  laylaNumber:    string
  businessNumber: string
  ownerCell:      string
  bilingual:      boolean
  appUrl:         string
}): void {
  const layla = national10(args.laylaNumber)
  const line = '─'.repeat(64)
  console.log(`\n${line}`)
  console.log('GO-LIVE SHEET')
  console.log(line)
  console.log(`  Layla's new line (keep private — lives behind forwarding): ${args.laylaNumber}`)
  console.log(`  Business number customers keep calling (unchanged):       ${args.businessNumber}`)
  console.log(`  Owner alert SMS goes to:                                   ${args.ownerCell}`)
  console.log('')
  console.log('CONDITIONAL CALL FORWARDING — dial from the BUSINESS phone.')
  console.log('Conditional = busy / no-answer only: the owner still rings first;')
  console.log('Layla only picks up the calls they miss.')
  console.log('')
  console.log('  Verizon Wireless')
  console.log(`    Activate:   *71${layla}          (one code covers busy + no-answer)`)
  console.log('    Deactivate: *73')
  console.log(`    (Verizon LANDLINE/Fios uses the *90 family: busy *90${layla} / off *91,`)
  console.log(`     no-answer *92${layla} / off *93)`)
  console.log('')
  console.log('  AT&T Wireless (GSM codes — dial, then press Call, wait for the tone)')
  console.log(`    No answer:      *61*${layla}#        off: ##61#`)
  console.log(`    Busy:           *67*${layla}#        off: ##67#`)
  console.log(`    Unreachable:    *62*${layla}#        off: ##62#`)
  console.log(`    All three:      *004*${layla}#       off: ##004#`)
  console.log('')
  console.log('  T-Mobile (GSM)')
  console.log(`    No answer:      **61*${layla}#       off: ##61#`)
  console.log(`    Busy:           **67*${layla}#       off: ##67#`)
  console.log(`    Unreachable:    **62*${layla}#       off: ##62#`)
  console.log(`    All three:      **004*${layla}#      off: ##004#`)
  console.log('')
  console.log('  US Cellular')
  console.log(`    Busy:           *90${layla}          off: *900`)
  console.log(`    No answer:      *92${layla}          off: *920`)
  console.log('')
  console.log('GO-LIVE TEST CHECKLIST — run in order; forward ONLY after 1-5 pass.')
  console.log(`  1. Call ${args.laylaNumber} directly → Layla answers in English with the`)
  console.log('     business name and the recording notice.')
  if (args.bilingual) {
    console.log('  2. Call again and open in Spanish → she follows in Spanish for the')
    console.log('     whole call (bilingual line is on for this tenant).')
  } else {
    console.log('  2. (English-only tenant — skip the Spanish call, or re-run onboarding')
    console.log('     later with --bilingual to turn the EN/ES line on.)')
  }
  console.log('  3. Ask to book a job → she asks the intake questions and offers a slot.')
  console.log(`  4. Use urgent phrasing ("pipe burst, water everywhere") → ${args.ownerCell}`)
  console.log("     gets an SMS alert that includes the caller's number.")
  console.log(`  5. Open the dashboard call log (${args.appUrl}/dashboard) — both calls`)
  console.log('     appear with summaries.')
  console.log(`  6. Activate forwarding on the owner's carrier (codes above), then call`)
  console.log(`     ${args.businessNumber} and let it ring out → Layla answers. Done.`)
  console.log(line)
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const inputs = parseInputs()

  // Env gate — checked in BOTH modes so a dry run genuinely proves
  // the live run's preconditions.
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN
  const VAPI_KEY     = process.env.VAPI_API_KEY
  for (const [name, val] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY,
    TWILIO_ACCOUNT_SID: TWILIO_SID,
    TWILIO_AUTH_TOKEN: TWILIO_TOKEN,
    VAPI_API_KEY: VAPI_KEY,
  })) {
    if (!val) {
      console.error(`[onboard] ${name} is required (load via .env.local)`)
      process.exit(1)
    }
  }
  if (!process.env.VAPI_WEBHOOK_SECRET) {
    console.warn('[onboard] VAPI_WEBHOOK_SECRET is not set — tool routes would accept unsigned callbacks.')
  }

  const appUrl = resolveOnboardAppUrl()
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } })

  console.log(`[onboard] ${inputs.live ? 'LIVE RUN' : 'DRY RUN (default — pass --live to execute)'}`)
  console.log(`[onboard]   business        ${inputs.name}`)
  console.log(`[onboard]   vertical        ${inputs.vertical}`)
  console.log(`[onboard]   owner           ${inputs.ownerName} <${inputs.ownerEmail}> ${inputs.ownerCell} (${inputs.ownerLanguage})`)
  console.log(`[onboard]   caller langs    {${inputs.callerLanguages.join(',')}}`)
  console.log(`[onboard]   existing number ${inputs.businessNumber} → searching area code ${inputs.areaCode}`)
  console.log(`[onboard]   app URL         ${appUrl}`)

  // ── Idempotency gate (read-only, both modes): an org with this
  // name already existing means this tenant was (at least partly)
  // onboarded — stop rather than duplicate. Escape ilike wildcards
  // so "100% Plumbing" doesn't match everything.
  const { data: existing, error: existErr } = await supabase
    .from('organizations')
    .select('id, name, vertical, call_agent_assistant_id, twilio_phone_number')
    .ilike('name', inputs.name.replace(/[%_]/g, '\\$&'))
    .limit(1)
  if (existErr) {
    console.error(`[onboard] duplicate check failed: ${existErr.message}`)
    process.exit(1)
  }
  if (existing && existing.length > 0) {
    const org = existing[0]
    console.error(`[onboard] STOP — an organization named "${org.name}" already exists (id ${org.id}, vertical ${org.vertical}).`)
    console.error(`[onboard]   assistant: ${org.call_agent_assistant_id ?? `none — seed with: npx tsx scripts/seed-vapi-assistant.ts ${org.id}`}`)
    console.error(`[onboard]   number:    ${org.twilio_phone_number ?? 'none — attach with scripts/provision-clinic-phone.ts once bought'}`)
    console.error('[onboard] This script only creates NEW tenants. To finish a partial onboard, use the per-step scripts above; to redo from scratch, delete the org first.')
    process.exit(1)
  }

  // ── Number preview (read-only GET, both modes) — shows the exact
  // number a live run would buy. A live run re-reads this same list
  // and buys the first candidate that succeeds.
  const twilio = await import('../src/lib/telephony/twilio-numbers')
  let candidates: AvailablePhoneNumber[] = []
  try {
    candidates = await twilio.searchAvailableLocal({ areaCode: inputs.areaCode, limit: 5 })
  } catch (err) {
    console.error(`[onboard] Twilio number search failed: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
  if (candidates.length === 0) {
    console.error(`[onboard] Twilio has no local voice+SMS numbers in area code ${inputs.areaCode}. Re-run with --area-code <nearby NPA>.`)
    process.exit(1)
  }

  const slugPreview = `${slugify(inputs.name)}-<uid6>`
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // ── DRY RUN: print the exact plan and the go-live sheet, then stop.
  if (!inputs.live) {
    console.log('\n[onboard] Plan (nothing below has been executed):')
    console.log(`[onboard]   1. WOULD create Supabase auth user ${inputs.ownerEmail} (no password;`)
    console.log('[onboard]      a recovery link would be printed for the founder to send).')
    console.log('[onboard]   2. WOULD insert organizations row:')
    console.log(`[onboard]        name '${inputs.name}', slug '${slugPreview}' (uid6 = first 6 of the auth user id)`)
    console.log(`[onboard]        vertical '${inputs.vertical}', owner_language '${inputs.ownerLanguage}', caller_languages {${inputs.callerLanguages.join(',')}}`)
    console.log(`[onboard]        notification_channel 'sms', owner_notify_e164 '${inputs.ownerCell}'`)
    console.log(`[onboard]        phone '${inputs.businessNumber}', email '${inputs.ownerEmail}'`)
    console.log(`[onboard]        plan 'trial', plan_status 'trial', trial_ends_at ${trialEndsAt}`)
    console.log(`[onboard]   3. WOULD insert owner profile ('${inputs.ownerName}', role owner) + run seed_default_stages RPC.`)
    console.log(`[onboard]   4. WOULD create inbound Vapi assistant "${inputs.name}${ASSISTANT_NAME_SUFFIX}" (${(inputs.name + ASSISTANT_NAME_SUFFIX).length}/${VAPI_ASSISTANT_NAME_LIMIT} chars)`)
    console.log(`[onboard]      via ensureInboundAssistant — ${inputs.vertical} prompt fragment, ${inputs.callerLanguages.includes('es') ? 'bilingual voice/transcriber (es-MX-DaliaNeural + deepgram multi)' : 'English voice/transcriber (Savannah + deepgram en)'}, tool callbacks → ${appUrl}.`)
    console.log(`[onboard]   5. WOULD buy Twilio LOCAL number ${candidates[0].e164} (${candidates[0].locality ?? '?'}, ${candidates[0].region ?? '?'}) — first of ${candidates.length} candidates in ${inputs.areaCode}:`)
    for (const c of candidates) {
      console.log(`[onboard]        ${c.e164}  voice:${c.capabilities.voice ? 'y' : 'n'} sms:${c.capabilities.sms ? 'y' : 'n'}  ${c.locality ?? ''} ${c.region ?? ''}`)
    }
    console.log('[onboard]   6. WOULD import that number to Vapi bound to the new assistant, then stamp')
    console.log('[onboard]      twilio_phone_number / twilio_phone_sid / vapi_phone_number_id /')
    console.log('[onboard]      phone_number_purchased_at + a phone_number_rent usage_event on the org.')
    console.log('[onboard]')
    console.log('[onboard] NOTE: availability shifts — the live run re-searches and may buy a')
    console.log(`[onboard] different ${inputs.areaCode} number than previewed above.`)
    printGoLiveSheet({
      laylaNumber:    candidates[0].e164,
      businessNumber: inputs.businessNumber,
      ownerCell:      inputs.ownerCell,
      bilingual:      inputs.callerLanguages.includes('es'),
      appUrl,
    })
    console.log('\n[onboard] DRY RUN complete — no writes, no purchases. Re-run with --live to execute.')
    return
  }

  // ── LIVE RUN ────────────────────────────────────────────────────
  try {
    // Step 1: auth user (mirrors /api/auth/signup step 1, minus the
    // password — the owner sets one via the recovery link).
    console.log(`[onboard] 1/6 Creating auth user ${inputs.ownerEmail}…`)
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: inputs.ownerEmail,
      email_confirm: true,
    })
    if (authErr || !authData?.user) {
      const msg = authErr?.message ?? 'no user returned'
      if (/already|exists|registered/i.test(msg)) {
        console.error(`[onboard] ${inputs.ownerEmail} already has an account. This script only onboards brand-new owners — link the existing user manually (insert a profiles row for their user id) or use a different email.`)
      } else {
        console.error(`[onboard] auth user creation failed: ${msg}`)
      }
      printLedger()
      process.exit(1)
    }
    const userId = authData.user.id
    ledger.push({
      what:    `Supabase auth user ${userId} (${inputs.ownerEmail})`,
      cleanup: 'Supabase dashboard → Authentication → delete user (cascades the profiles row), or auth.admin.deleteUser.',
    })

    // Step 2: organization (mirrors signup step 2 + the multi-vertical
    // Phase 1 columns; trades/food/general reuse the same trial arming
    // so lifecycle emails + lockout apply unchanged).
    const slug = `${slugify(inputs.name)}-${userId.slice(0, 6)}`
    console.log(`[onboard] 2/6 Creating organization '${inputs.name}' (${slug})…`)
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        name:                 inputs.name,
        slug,
        phone:                inputs.businessNumber,
        email:                inputs.ownerEmail,
        trial_ends_at:        trialEndsAt,
        plan:                 'trial',
        plan_status:          'trial',
        vertical:             inputs.vertical,
        owner_language:       inputs.ownerLanguage,
        caller_languages:     inputs.callerLanguages,
        notification_channel: 'sms',
        owner_notify_e164:    inputs.ownerCell,
      })
      .select('id')
      .single()
    if (orgErr || !org) {
      console.error(`[onboard] org creation failed: ${orgErr?.message}`)
      printLedger()
      process.exit(1)
    }
    const orgId: string = org.id
    ledger.push({
      what:    `organizations row ${orgId} ('${inputs.name}')`,
      cleanup: `delete from organizations where id='${orgId}'; -- cascades stages/contacts/etc`,
    })

    // Step 3: owner profile + default pipeline stages (signup steps 3+4).
    console.log('[onboard] 3/6 Creating owner profile + seeding pipeline stages…')
    const { error: profileErr } = await supabase.from('profiles').insert({
      id:              userId,
      organization_id: orgId,
      full_name:       inputs.ownerName,
      email:           inputs.ownerEmail,
      role:            'owner',
    })
    if (profileErr) {
      console.error(`[onboard] profile creation failed: ${profileErr.message}`)
      printLedger()
      process.exit(1)
    }
    ledger.push({
      what:    `profiles row ${userId} (owner of ${orgId})`,
      cleanup: 'Deleted automatically with the auth user; or: delete from profiles where id=\'' + userId + '\';',
    })
    const { error: stagesErr } = await supabase.rpc('seed_default_stages', { org_id: orgId })
    if (stagesErr) {
      console.error(`[onboard] seed_default_stages failed: ${stagesErr.message}`)
      printLedger()
      process.exit(1)
    }

    // Set-password link for the owner (non-fatal — the forgot-password
    // flow on the site covers the failure case).
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type:  'recovery',
      email: inputs.ownerEmail,
    })
    const actionLink = linkData?.properties?.action_link
    if (linkErr || !actionLink) {
      console.warn(`[onboard] could not generate a set-password link (${linkErr?.message ?? 'no link returned'}) — send the owner to ${appUrl}/forgot-password instead.`)
    } else {
      console.log(`[onboard]     Owner set-password link (send via SMS/WhatsApp): ${actionLink}`)
    }

    // Step 4: inbound assistant via the shared seeding service — the
    // SAME code path the product uses, so vertical prompt fragments,
    // bilingual voice/transcriber, and tool wiring can't drift.
    console.log(`[onboard] 4/6 Seeding inbound assistant "${inputs.name}${ASSISTANT_NAME_SUFFIX}"…`)
    const { ensureInboundAssistant } = await import('../src/lib/voice-agent/seed-assistants')
    const { assistantId } = await ensureInboundAssistant({ supabase, orgId, appUrl })
    ledger.push({
      what:    `Vapi inbound assistant ${assistantId}`,
      cleanup: `Delete in the Vapi dashboard, then: update organizations set call_agent_assistant_id=null where id='${orgId}';`,
    })
    console.log(`[onboard]     assistant ${assistantId}`)

    // Step 5: buy the local number. Availability can shift between the
    // preview search and now, so walk the candidate list in order.
    // purchaseNumber is idempotent on (account, number) — a retry
    // after a crash can't double-charge (see twilio-numbers.ts).
    console.log(`[onboard] 5/6 Buying local number in ${inputs.areaCode}…`)
    let purchased: { sid: string; e164: string } | null = null
    const buyFailures: string[] = []
    for (const cand of candidates) {
      try {
        purchased = await twilio.purchaseNumber({
          e164:         cand.e164,
          friendlyName: `${inputs.name} — Layla line`,
        })
        break
      } catch (err) {
        buyFailures.push(`${cand.e164}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (!purchased) {
      console.error(`[onboard] all ${candidates.length} candidate numbers failed to purchase:\n  ${buyFailures.join('\n  ')}`)
      printLedger()
      process.exit(1)
    }
    ledger.push({
      what:    `Twilio number ${purchased.e164} (${purchased.sid}) — MONTHLY RENT ACCRUES until released`,
      cleanup: `Twilio console → Phone Numbers → Active numbers → release, or DELETE /2010-04-01/Accounts/<sid>/IncomingPhoneNumbers/${purchased.sid}.json`,
    })
    console.log(`[onboard]     bought ${purchased.e164} (${purchased.sid})`)

    // Step 6: import to Vapi bound to THIS org's new assistant (never
    // touches any other number's voice config), with the mandatory
    // 409/400 → GET recovery from provision-clinic-phone.ts.
    console.log('[onboard] 6/6 Importing the number to Vapi + stamping the org…')
    const vapiNumbers = await import('../src/lib/telephony/vapi-phone-numbers')
    let vapiPhone: VapiPhoneNumberResource
    try {
      vapiPhone = await vapiNumbers.registerNumber({
        twilioPhoneNumber: purchased.e164,
        twilioAccountSid:  TWILIO_SID!,
        twilioAuthToken:   TWILIO_TOKEN!,
        assistantId,
        name:              `${inputs.name} — primary line`.slice(0, 40),
      })
    } catch (err) {
      if (err instanceof vapiNumbers.VapiApiError && (err.status === 409 || err.status === 400)) {
        console.warn(`[onboard] Vapi returned ${err.status} on POST /phone-number — recovering via GET by number…`)
        vapiPhone = await lookupVapiNumberByE164(purchased.e164)
      } else {
        throw err
      }
    }
    ledger.push({
      what:    `Vapi phone-number resource ${vapiPhone.id} (${purchased.e164})`,
      cleanup: `curl -X DELETE https://api.vapi.ai/phone-number/${vapiPhone.id} -H "Authorization: Bearer $VAPI_API_KEY"`,
    })

    const { error: stampErr } = await supabase
      .from('organizations')
      .update({
        twilio_phone_number:       purchased.e164,
        twilio_phone_sid:          purchased.sid,
        vapi_phone_number_id:      vapiPhone.id,
        phone_number_purchased_at: new Date().toISOString(),
      })
      .eq('id', orgId)
    if (stampErr) {
      console.error(`[onboard] Twilio + Vapi are live but stamping the org failed: ${stampErr.message}`)
      console.error(`[onboard] Manually run: update organizations set twilio_phone_number='${purchased.e164}', twilio_phone_sid='${purchased.sid}', vapi_phone_number_id='${vapiPhone.id}', phone_number_purchased_at=now() where id='${orgId}';`)
      printLedger()
      process.exit(1)
    }

    // phone_number_rent usage_event — same audit row provision-clinic-
    // phone.ts writes; non-fatal by the same reasoning (the external
    // resources are already live; don't force cleanup over an audit row).
    const now = new Date()
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    const { error: usageErr } = await supabase
      .from('usage_events')
      .upsert(
        {
          organization_id:      orgId,
          kind:                 'phone_number_rent',
          quantity:             1,
          billing_period_start: now.toISOString().slice(0, 8) + '01',
          billing_period_end:   `${periodEnd.getUTCFullYear()}-${String(periodEnd.getUTCMonth() + 1).padStart(2, '0')}-${String(periodEnd.getUTCDate()).padStart(2, '0')}`,
          source_ref:           `init:${orgId}`,
        },
        { onConflict: 'organization_id,kind,source_ref', ignoreDuplicates: true },
      )
    if (usageErr) {
      console.warn(`[onboard] usage_events insert failed (non-fatal): ${usageErr.message}`)
    }

    console.log('\n[onboard] Tenant is live:')
    console.log(`[onboard]   org         ${orgId} (${inputs.name}, ${inputs.vertical})`)
    console.log(`[onboard]   owner       ${inputs.ownerEmail} / ${inputs.ownerCell}`)
    console.log(`[onboard]   assistant   ${assistantId}`)
    console.log(`[onboard]   Layla line  ${purchased.e164} (twilio ${purchased.sid}, vapi ${vapiPhone.id})`)
    printGoLiveSheet({
      laylaNumber:    purchased.e164,
      businessNumber: inputs.businessNumber,
      ownerCell:      inputs.ownerCell,
      bilingual:      inputs.callerLanguages.includes('es'),
      appUrl,
    })
  } catch (err) {
    console.error(`[onboard] FAILED mid-flight: ${err instanceof Error ? err.message : err}`)
    printLedger()
    process.exit(1)
  }
}

main().catch(err => {
  console.error('[onboard] Unexpected error:', err instanceof Error ? err.message : err)
  printLedger()
  process.exit(1)
})
