/**
 * Resend idempotency-key smoke test.
 *
 * Verifies four contracts that the cron-driven email lifecycle relies on:
 *
 *   (a) Same `idempotencyKey` reused → Resend returns the same message id
 *       (within the 24h dedup window).
 *   (b) Different keys for otherwise-identical payloads → distinct ids.
 *   (c) `queued` → `sent` lifecycle on `messages` keyed by row id works
 *       end-to-end against the partial unique index.
 *   (d) Simulated post-send-UPDATE failure: re-sending with the same key
 *       does NOT produce a second send (Resend dedups), so the retry
 *       path is safe.
 *
 * Test recipient: `delivered@resend.dev` — a Resend-provided sink address
 * that always reports as delivered without actually emailing a human.
 *
 * Required env in .env.local:
 *   RESEND_API_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TEST_ORG_ID         (a real organization row to attribute the messages to)
 *   TEST_CONTACT_ID     (a real contact row in that org — won't be modified)
 *
 * Run:
 *   npx tsx scripts/test-resend-idempotency.ts
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — one or more assertions failed
 *   2 — fatal (missing env, network, etc.)
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { randomUUID } from 'crypto'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TEST_TO = 'delivered@resend.dev'

async function main() {
  const orgId     = process.env.TEST_ORG_ID
  const contactId = process.env.TEST_CONTACT_ID
  if (!orgId || !contactId) {
    throw new Error('TEST_ORG_ID and TEST_CONTACT_ID must be set in .env.local')
  }
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY must be set in .env.local')
  }

  const { sendEmail }     = await import('@/lib/resend')
  const { supabaseAdmin } = await import('@/lib/supabase/admin')

  // Per-run prefix lets us scope the orphan-row cleanup at the end without
  // touching anyone else's test rows.
  const runId      = randomUUID()
  const subjectTag = `[idempotency-test ${runId}]`

  let passed = 0
  let failed = 0
  const check = (cond: boolean, label: string) => {
    if (cond) { console.log(`PASS  ${label}`); passed++ }
    else      { console.log(`FAIL  ${label}`); failed++ }
  }

  console.log(`\n=== Resend idempotency smoke test ===`)
  console.log(`runId: ${runId}`)
  console.log(`org:     ${orgId}`)
  console.log(`contact: ${contactId}\n`)

  let exitCode = 0

  try {
    // ── (a) same key → same provider_id ──────────────────────────
    {
      const key      = randomUUID()
      const subject  = `${subjectTag} (a) same-key`
      const html     = `<p>Same-key test, key=${key}</p>`

      const r1 = await sendEmail({ to: TEST_TO, subject, html, idempotencyKey: key })
      const r2 = await sendEmail({ to: TEST_TO, subject, html, idempotencyKey: key })

      console.log(`  (a) r1.provider_id = ${r1.provider_id}`)
      console.log(`  (a) r2.provider_id = ${r2.provider_id}`)
      check(!!r1.provider_id && r1.provider_id === r2.provider_id,
        `(a) reusing the same idempotencyKey yields the same provider_id`)
    }

    // ── (b) different keys → different provider_ids ──────────────
    {
      const subject = `${subjectTag} (b) different-key`
      const html    = `<p>Different-key test</p>`

      const r1 = await sendEmail({ to: TEST_TO, subject, html, idempotencyKey: randomUUID() })
      const r2 = await sendEmail({ to: TEST_TO, subject, html, idempotencyKey: randomUUID() })

      console.log(`  (b) r1.provider_id = ${r1.provider_id}`)
      console.log(`  (b) r2.provider_id = ${r2.provider_id}`)
      check(!!r1.provider_id && !!r2.provider_id && r1.provider_id !== r2.provider_id,
        `(b) different idempotencyKeys yield different provider_ids`)
    }

    // ── (c) queued → sent lifecycle, key = messages.id ──────────
    let lifecycleRowId: string | null = null
    {
      const subject = `${subjectTag} (c) lifecycle`
      const body    = `Lifecycle test for run ${runId}`

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('messages')
        .insert({
          organization_id: orgId,
          contact_id:      contactId,
          channel:         'email',
          direction:       'outbound',
          status:          'queued',
          subject,
          body,
          to_address:      TEST_TO,
        })
        .select('id')
        .single()

      if (insErr || !inserted) throw new Error(`Lifecycle insert failed: ${insErr?.message}`)
      lifecycleRowId = inserted.id

      const result = await sendEmail({
        to: TEST_TO,
        subject,
        html: `<p>${body}</p>`,
        idempotencyKey: inserted.id,
      })

      const { error: updErr } = await supabaseAdmin
        .from('messages')
        .update({
          status:      'sent',
          provider_id: result.provider_id,
          sent_at:     new Date().toISOString(),
        })
        .eq('id', inserted.id)

      if (updErr) throw new Error(`Lifecycle update failed: ${updErr.message}`)

      const { data: row } = await supabaseAdmin
        .from('messages')
        .select('status, provider_id')
        .eq('id', inserted.id)
        .single()

      console.log(`  (c) row.status = ${row?.status}, row.provider_id = ${row?.provider_id}`)
      check(row?.status === 'sent' && !!row?.provider_id,
        `(c) queued → sent lifecycle keyed by messages.id completes end-to-end`)
    }

    // ── (d) simulated post-update failure: re-send with same key ─
    // Models the failure mode where send-call succeeded but the post-send
    // UPDATE didn't land. The cron will retry next tick using the same row
    // id as the key — Resend MUST dedup, otherwise we'd double-send.
    {
      const key     = randomUUID()
      const subject = `${subjectTag} (d) post-update-failure-retry`
      const html    = `<p>Post-update failure retry simulation for run ${runId}</p>`

      const firstSend  = await sendEmail({ to: TEST_TO, subject, html, idempotencyKey: key })
      // No DB update happens here — that's the simulated failure.
      const retrySend  = await sendEmail({ to: TEST_TO, subject, html, idempotencyKey: key })

      console.log(`  (d) firstSend.provider_id = ${firstSend.provider_id}`)
      console.log(`  (d) retrySend.provider_id = ${retrySend.provider_id}`)
      check(!!firstSend.provider_id && firstSend.provider_id === retrySend.provider_id,
        `(d) retry-with-same-key after simulated post-update failure does NOT produce a second send`)
    }

    // ── Cleanup: drop the lifecycle row ─────────────────────────
    if (lifecycleRowId) {
      const { error: delErr } = await supabaseAdmin
        .from('messages')
        .delete()
        .eq('id', lifecycleRowId)
      if (delErr) console.error(`Cleanup (lifecycle row) failed: ${delErr.message}`)
      else        console.log(`\nDeleted lifecycle test row ${lifecycleRowId}`)
    }

    // Belt-and-suspenders: clean any orphan rows tagged with this run.
    const { error: orphanErr } = await supabaseAdmin
      .from('messages')
      .delete()
      .like('subject', `%${runId}%`)
    if (orphanErr) console.error(`Cleanup (orphan rows) failed: ${orphanErr.message}`)
  } catch (err: any) {
    console.error(`\nFATAL: ${err?.message ?? err}`)
    if (err?.stack) console.error(err.stack)
    exitCode = 2
  }

  console.log(`\n=== Results ===`)
  console.log(`PASS: ${passed}`)
  console.log(`FAIL: ${failed}`)
  if (failed > 0 && exitCode === 0) exitCode = 1
  process.exit(exitCode)
}

main().catch((err: any) => {
  console.error(`\nUnhandled: ${err?.message ?? err}`)
  if (err?.stack) console.error(err.stack)
  process.exit(2)
})
