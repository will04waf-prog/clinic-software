/**
 * One-shot: register the 6 WhatsApp owner-alert templates from
 * src/lib/notify/templates.ts with Twilio's Content API and submit
 * each for WhatsApp (Meta) approval as category UTILITY.
 *
 * Imports the template definitions directly, so the submitted bodies
 * are character-for-character the ones the runtime will send —
 * transcription drift is impossible.
 *
 * Usage:
 *   npx tsx scripts/register-whatsapp-templates.ts            # create + submit
 *   npx tsx scripts/register-whatsapp-templates.ts --status   # poll approval status
 *
 * Idempotency: on create, if a Content resource with the same
 * friendly_name already exists, it is reused (no duplicate).
 * Prints the ContentSid (HX…) per template + the env var to set.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { OWNER_ALERT_TEMPLATES, type OwnerAlertTemplate, type TemplateVariant } from '../src/lib/notify/templates'

for (const path of ['.env.local', '.env']) {
  const full = resolve(process.cwd(), path)
  if (existsSync(full)) loadEnv({ path: full })
}

const SID = process.env.TWILIO_ACCOUNT_SID
const TOK = process.env.TWILIO_AUTH_TOKEN
if (!SID || !TOK) {
  console.error('TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN required')
  process.exit(1)
}
const AUTH = 'Basic ' + Buffer.from(`${SID}:${TOK}`).toString('base64')
const BASE = 'https://content.twilio.com/v1'

// Realistic sample values for Meta's review, per template type.
const SAMPLES: Record<string, Record<string, string>> = {
  job_summary:          { '1': 'Rivera Landscaping', '2': 'booked a job', '3': 'https://tarhunna.net/calls' },
  booking_confirmation: { '1': 'Rivera Landscaping', '2': 'lawn service, Tue 2:30 PM', '3': 'https://tarhunna.net/calendar' },
  urgent_alert:         { '1': 'Rivera Landscaping', '2': '+13015551234', '3': 'burst pipe flooding the kitchen' },
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json: json as Record<string, unknown> }
}

async function findExisting(friendlyName: string): Promise<string | null> {
  const { json } = await api('GET', `/Content?PageSize=100`)
  const contents = (json.contents ?? []) as { sid: string; friendly_name: string }[]
  return contents.find(c => c.friendly_name === friendlyName)?.sid ?? null
}

async function createOne(tpl: OwnerAlertTemplate, v: TemplateVariant): Promise<string | null> {
  const existing = await findExisting(v.name)
  if (existing) {
    console.log(`  reuse   ${v.name} (${v.language}) → ${existing}`)
    return existing
  }
  const { status, json } = await api('POST', '/Content', {
    friendly_name: v.name,
    language: v.language,
    variables: SAMPLES[tpl.type],
    types: { 'twilio/text': { body: v.body } },
  })
  if (status >= 300 || !json.sid) {
    console.error(`  CREATE FAILED ${v.name}: ${status} ${JSON.stringify(json).slice(0, 200)}`)
    return null
  }
  console.log(`  created ${v.name} (${v.language}) → ${json.sid}`)
  return json.sid as string
}

async function submitApproval(sid: string, v: TemplateVariant): Promise<void> {
  const { status, json } = await api('POST', `/Content/${sid}/ApprovalRequests/whatsapp`, {
    name: v.name,
    category: 'UTILITY',
  })
  if (status >= 300) {
    console.error(`  SUBMIT FAILED ${v.name}: ${status} ${JSON.stringify(json).slice(0, 250)}`)
  } else {
    console.log(`  submitted ${v.name} for WhatsApp approval (UTILITY)`)
  }
}

async function approvalStatus(sid: string): Promise<string> {
  const { json } = await api('GET', `/Content/${sid}/ApprovalRequests`)
  const wa = (json as { whatsapp?: { status?: string; rejection_reason?: string } }).whatsapp
  const st = wa?.status ?? 'unsubmitted'
  return wa?.rejection_reason ? `${st} (${wa.rejection_reason})` : st
}

const VARIANTS: { tpl: OwnerAlertTemplate; v: TemplateVariant }[] = []
for (const tpl of Object.values(OWNER_ALERT_TEMPLATES)) {
  VARIANTS.push({ tpl, v: tpl.en }, { tpl, v: tpl.es })
}

async function main() {
  const statusOnly = process.argv.includes('--status')

  if (statusOnly) {
    console.log('Approval status:')
    for (const { v } of VARIANTS) {
      const sid = await findExisting(v.name)
      if (!sid) { console.log(`  ${v.name.padEnd(24)} NOT CREATED`); continue }
      console.log(`  ${v.name.padEnd(24)} ${sid}  ${await approvalStatus(sid)}`)
    }
    return
  }

  console.log('Creating + submitting 6 WhatsApp templates…')
  const sids: Record<string, string> = {}
  for (const { tpl, v } of VARIANTS) {
    const sid = await createOne(tpl, v)
    if (sid) {
      sids[v.contentSidEnv] = sid
      await submitApproval(sid, v)
    }
  }
  console.log('\nEnv vars to set:')
  for (const [env, sid] of Object.entries(sids)) console.log(`  ${env}=${sid}`)
}

main().catch(err => { console.error(err); process.exit(1) })
