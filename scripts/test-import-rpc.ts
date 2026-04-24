/**
 * PR B end-to-end smoke test — server-side, no user session required.
 *
 * Verifies that the bulk-import DB primitives fit together correctly:
 *   1. bulk_insert_contacts_ignore_dupes RPC (migration 20260422160000)
 *   2. partial unique index on (organization_id, lower(email))
 *      where deleted_at is null and email is not null
 *   3. contacts_active view hides soft-deleted rows
 *   4. soft-delete roundtrip — update base, view disappears
 *
 * The HTTP route's auth + chunking logic is NOT exercised here; that's a
 * PR C concern once the UI has a real session to ride on.
 *
 * Run (from project root):
 *   npx tsx scripts/test-import-rpc.ts
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — one or more assertions failed
 *   2 — fatal (connection, missing env, no org, RPC error, etc.)
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

// Env must be loaded BEFORE any import that reads process.env at module scope.
// @/lib/supabase/admin reads SUPABASE_SERVICE_ROLE_KEY at import time, so we
// dynamic-import it from inside main() below.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  const { supabaseAdmin } = await import('@/lib/supabase/admin')

  let passed = 0
  let failed = 0
  const check = (cond: boolean, label: string) => {
    if (cond) {
      console.log(`PASS  ${label}`)
      passed++
    } else {
      console.log(`FAIL  ${label}`)
      failed++
    }
  }

  const ts            = Date.now()
  const email1        = `prb-${ts}-1@tarhunna-qa.internal`
  const email2        = `prb-${ts}-2@tarhunna-qa.internal`
  const email3Variant = `PRB-${ts}-1@TARHUNNA-QA.INTERNAL` // case variant of email1
  const email4        = `prb-${ts}-4@tarhunna-qa.internal` // explicit procedure_interest: null
  const nowIso        = new Date().toISOString()

  console.log(`\n=== PR B end-to-end smoke test ===`)
  console.log(`Timestamp seed: ${ts}`)
  console.log(`  email1         = ${email1}`)
  console.log(`  email2         = ${email2}`)
  console.log(`  email3Variant  = ${email3Variant}  (case variant of email1)`)
  console.log(`  email4         = ${email4}  (explicit procedure_interest: null)\n`)

  // Pick the first org — stable, avoids guessing at UUIDs.
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (orgErr) throw new Error(`Failed to fetch org: ${orgErr.message}`)
  if (!org)   throw new Error(`No organizations in database — cannot run test.`)

  console.log(`Using org: ${org.name} (${org.id})`)

  // contact_imports.user_id is NOT NULL, FKs to auth.users. Grab any
  // profile in the org to use as the stand-in user for this test import.
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', org.id)
    .limit(1)
    .maybeSingle()

  if (profErr)  throw new Error(`Failed to fetch profile: ${profErr.message}`)
  if (!profile) throw new Error(`No profile in org ${org.id} — cannot attribute test import.`)

  let importId: string | null = null
  let exitCode = 0

  try {
    // 1. Create a test contact_imports row.
    const { data: imp, error: impErr } = await supabaseAdmin
      .from('contact_imports')
      .insert({
        organization_id: org.id,
        user_id:         profile.id,
        row_count:       4,
        source:          'paste',
        status:          'processing',
      })
      .select('id')
      .single()

    if (impErr || !imp) throw new Error(`Failed to create import row: ${impErr?.message}`)
    importId = imp.id
    console.log(`Created test import: ${importId}\n`)

    // 2. Call the RPC with 4 rows:
    //      1. fresh insert
    //      2. fresh insert
    //      3. mixed-case variant of #1 — must collide via lower(email) partial unique index
    //      4. fresh insert with `procedure_interest: null` explicit — regression
    //         guard for the RPC hardening in migration 20260424120000. Without
    //         that fix, `jsonb_array_elements_text` chokes on the jsonb-null
    //         scalar and the entire chunk aborts, which would fail every
    //         assertion below, not just this one. Reaching the per-row
    //         procedure_interest=NULL check at all is load-bearing evidence.
    //
    // The first three rows pass only the fields the production route actually
    // sends (absent fields = undefined, stripped by JSON.stringify). Row 4
    // intentionally sends an explicit null to exercise the hardened guard.
    const rpcRows = [
      { first_name: 'PRB Test 1',          email: email1,        last_activity_at: nowIso },
      { first_name: 'PRB Test 2',          email: email2,        last_activity_at: nowIso },
      { first_name: 'PRB Test 3 Variant',  email: email3Variant, last_activity_at: nowIso },
      { first_name: 'PRB Test 4 NullProc', email: email4,        last_activity_at: nowIso, procedure_interest: null },
    ]

    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
      'bulk_insert_contacts_ignore_dupes',
      { p_org_id: org.id, p_import_id: importId, p_rows: rpcRows },
    )

    if (rpcErr) throw new Error(`RPC failed: ${rpcErr.message}`)

    const rpcRow        = Array.isArray(rpcData) ? rpcData[0] : rpcData
    const insertedCount = (rpcRow?.inserted_count as number | undefined) ?? -1
    const skippedCount  = (rpcRow?.skipped_count  as number | undefined) ?? -1
    console.log(`RPC returned: inserted=${insertedCount}, skipped=${skippedCount}\n`)

    check(insertedCount === 3, `RPC inserted_count = 3  (got ${insertedCount})`)
    check(skippedCount  === 1, `RPC skipped_count  = 1  (got ${skippedCount})`)

    // 3. Base-table verification.
    const { data: baseRows, error: baseErr } = await supabaseAdmin
      .from('contacts')
      .select('id, first_name, email, procedure_interest, import_id, deleted_at')
      .eq('import_id', importId)

    if (baseErr) throw new Error(`Base-table read failed: ${baseErr.message}`)

    check(
      (baseRows?.length ?? 0) === 3,
      `contacts base table has 3 rows tagged with import_id (got ${baseRows?.length ?? 0})`,
    )

    const storedEmails = new Set((baseRows ?? []).map((r) => r.email))
    check(storedEmails.has(email1),         `contacts contains email1 (lowercase)`)
    check(storedEmails.has(email2),         `contacts contains email2`)
    check(storedEmails.has(email4),         `contacts contains email4 (explicit-null procedure_interest row)`)
    check(!storedEmails.has(email3Variant), `contacts does NOT contain the mixed-case variant`)
    check(
      (baseRows ?? []).every((r) => r.deleted_at === null),
      `all inserted rows have deleted_at = NULL`,
    )

    // RPC-hardening regression guard: the explicit-JSON-null row must land
    // with procedure_interest = SQL NULL in the column. If the old guard
    // were still in place, execution would have errored back at the RPC
    // call and we'd never reach here — so passing this is double-duty
    // evidence (error didn't fire AND the column was set correctly).
    const nullProcRow = (baseRows ?? []).find((r) => r.email === email4)
    check(
      !!nullProcRow && nullProcRow.procedure_interest === null,
      `email4 row has procedure_interest = NULL (got ${JSON.stringify(nullProcRow?.procedure_interest)})`,
    )

    // 4. contacts_active view — should match base pre-soft-delete.
    const { data: viewRows, error: viewErr } = await supabaseAdmin
      .from('contacts_active')
      .select('id, email')
      .eq('import_id', importId)

    if (viewErr) throw new Error(`View read failed: ${viewErr.message}`)

    check(
      (viewRows?.length ?? 0) === 3,
      `contacts_active view returns the same 3 rows (got ${viewRows?.length ?? 0})`,
    )

    // 5. Soft-delete roundtrip.
    const { error: softErr } = await supabaseAdmin
      .from('contacts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('import_id', importId)
      .is('deleted_at', null)

    if (softErr) throw new Error(`Soft-delete failed: ${softErr.message}`)

    const { data: postSoftBase, error: postSoftErr } = await supabaseAdmin
      .from('contacts')
      .select('id, deleted_at')
      .eq('import_id', importId)

    if (postSoftErr) throw new Error(`Post-soft-delete base read failed: ${postSoftErr.message}`)

    check(
      (postSoftBase?.length ?? 0) === 3,
      `base table still has 3 rows after soft-delete (got ${postSoftBase?.length ?? 0})`,
    )
    check(
      (postSoftBase ?? []).every((r) => r.deleted_at !== null),
      `both rows now have deleted_at non-null`,
    )

    const { data: postSoftView, error: postSoftViewErr } = await supabaseAdmin
      .from('contacts_active')
      .select('id')
      .eq('import_id', importId)

    if (postSoftViewErr) throw new Error(`Post-soft-delete view read failed: ${postSoftViewErr.message}`)

    check(
      (postSoftView?.length ?? 0) === 0,
      `contacts_active view hides soft-deleted rows (got ${postSoftView?.length ?? 0}, want 0)`,
    )
  } catch (err: any) {
    console.error(`\nFATAL during test: ${err?.message ?? err}`)
    if (err?.stack) console.error(err.stack)
    exitCode = 2
  } finally {
    // Always clean up — even on failure — so the DB doesn't accumulate test
    // detritus across runs. Cleanup errors are logged but don't override the
    // outer exit code beyond what the assertions already decided.
    if (importId) {
      console.log(`\n=== Cleanup ===`)

      // Delete contacts first: the FK on contacts.import_id is ON DELETE SET
      // NULL, so deleting contact_imports first would orphan them with a
      // null import_id and make them unfindable for cleanup.
      const { error: cleanContactsErr } = await supabaseAdmin
        .from('contacts')
        .delete()
        .eq('import_id', importId)
      if (cleanContactsErr) {
        console.error(`Cleanup (contacts): ${cleanContactsErr.message}`)
      } else {
        console.log(`Deleted test contacts for import ${importId}`)
      }

      const { error: cleanImpErr } = await supabaseAdmin
        .from('contact_imports')
        .delete()
        .eq('id', importId)
      if (cleanImpErr) {
        console.error(`Cleanup (contact_imports): ${cleanImpErr.message}`)
      } else {
        console.log(`Deleted test contact_imports row ${importId}`)
      }
    }
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
