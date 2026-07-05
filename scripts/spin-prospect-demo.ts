/**
 * Spin up a personalized prospect demo (operator CLI).
 *
 * Clones the capped WEB demo assistant (the one behind the landing
 * page's in-browser call), reskins it for one prospect clinic — their
 * name in the greeting, their city/address/services in the prompt,
 * honesty rails telling her she's a preview — and registers the slug
 * in demo_prospects so tarhunna.net/demo/<slug> resolves to it.
 *
 * Usage:
 *
 *   npx tsx scripts/spin-prospect-demo.ts \
 *     --slug vishka \
 *     --name "Vishka Skincare & MedSpa" \
 *     --city "Arlington, VA" \
 *     --address "3801 N Fairfax Dr Ste 31A, Arlington, VA 22203" \
 *     --website "https://vishkaskincare.com" \
 *     --services "Botox, Dysport, Juvederm fillers, laser, body contouring"
 *
 * Re-running with the same slug creates a FRESH assistant and points
 * the row at it (old assistants stay in Vapi; clean up via dashboard).
 *
 * Env required (loaded from .env.local): VAPI_API_KEY,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const envPath = resolve(process.cwd(), '.env.local')
if (existsSync(envPath)) loadEnv({ path: envPath })

/** The capped web demo assistant — 180s max, 30s silence, gpt-5.4. */
const WEB_DEMO_ASSISTANT_ID = '9410db69-f98f-4dbc-a85f-67dd5c2b821a'
const SOURCE_CLINIC_NAME = 'Tarhunna Aesthetics'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const slug = arg('slug')
  const name = arg('name')
  const city = arg('city') ?? ''
  const address = arg('address') ?? ''
  const website = arg('website') ?? ''
  const services = (arg('services') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const notes = arg('notes') ?? ''

  if (!slug || !name) {
    console.error('Required: --slug <kebab-slug> --name "Clinic Name"')
    process.exit(1)
  }
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) {
    console.error('Slug must be kebab-case: lowercase letters, digits, dashes.')
    process.exit(1)
  }

  const vapiKey = process.env.VAPI_API_KEY
  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!vapiKey || !dbUrl || !dbKey) {
    console.error('Missing env: VAPI_API_KEY / SUPABASE url / service key.')
    process.exit(1)
  }

  // 1. Fetch the capped web-demo assistant as the template.
  const srcRes = await fetch(
    `https://api.vapi.ai/assistant/${WEB_DEMO_ASSISTANT_ID}`,
    { headers: { Authorization: `Bearer ${vapiKey}` } },
  )
  if (!srcRes.ok) {
    console.error('Failed to fetch template assistant:', await srcRes.text())
    process.exit(1)
  }
  const src = (await srcRes.json()) as Record<string, unknown>
  for (const k of ['id', 'orgId', 'createdAt', 'updatedAt', 'isServerUrlSecretSet']) {
    delete src[k]
  }

  // 2. Reskin: greeting + every prompt mention of the demo clinic.
  src.name = `Web demo — ${slug}`.slice(0, 40)
  if (typeof src.firstMessage === 'string') {
    src.firstMessage = src.firstMessage.replaceAll(SOURCE_CLINIC_NAME, name)
  }

  const model = src.model as {
    messages?: { role: string; content: string }[]
  }
  const sys = model?.messages?.[0]
  if (!sys || typeof sys.content !== 'string') {
    console.error('Template assistant has no system prompt — aborting.')
    process.exit(1)
  }
  sys.content = sys.content.replaceAll(SOURCE_CLINIC_NAME, name)
  sys.content += [
    '',
    '',
    '## PROSPECT PREVIEW — GROUND TRUTH FOR THIS DEMO',
    `You are a personalized PREVIEW of Layla answering for ${name}` +
      (city ? ` in ${city}` : '') +
      `. ${name} has NOT deployed you yet — this demo exists so the owner can hear what their front desk would sound like.`,
    address
      ? `The clinic's real address is ${address}. Use it for directions.`
      : '',
    services.length > 0
      ? `Services the clinic actually offers (use these when the caller asks what's available): ${services.join(', ')}.`
      : '',
    website ? `The clinic's website is ${website}.` : '',
    'Rails for this preview: the calendar behind you is a SAMPLE — offer times naturally, but if asked whether a booking is real, be honest that this is a demonstration. Never invent prices. If the caller asks whether they are talking to the real clinic, say this is a preview built by Tarhunna to show the owner what Layla can do, and the fastest way to make it real is tarhunna.net.',
  ]
    .filter(Boolean)
    .join('\n')

  // 3. Create the assistant.
  const createRes = await fetch('https://api.vapi.ai/assistant', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${vapiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(src),
  })
  if (!createRes.ok) {
    console.error('Assistant creation failed:', await createRes.text())
    process.exit(1)
  }
  const created = (await createRes.json()) as {
    id: string
    maxDurationSeconds?: number
    silenceTimeoutSeconds?: number
  }
  console.log(
    `Assistant ${created.id} (caps: ${created.maxDurationSeconds}s / ${created.silenceTimeoutSeconds}s silence)`,
  )

  // 4. Register the slug (upsert — respins repoint the row).
  const db = createClient(dbUrl, dbKey)
  const { error } = await db.from('demo_prospects').upsert(
    {
      slug,
      clinic_name: name,
      city: city || null,
      address: address || null,
      services: services.length > 0 ? services : null,
      website: website || null,
      vapi_assistant_id: created.id,
      notes: notes || null,
    },
    { onConflict: 'slug' },
  )
  if (error) {
    console.error('DB upsert failed:', error.message)
    process.exit(1)
  }

  console.log(`\nLive: https://tarhunna.net/demo/${slug}`)
  console.log(`${name} — Layla answers as their front desk. Send the link.`)
}

void main()
