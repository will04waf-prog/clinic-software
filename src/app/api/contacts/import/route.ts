import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { validateEmail, normalizePhone } from '@/lib/validators'
import { checkBulkImportSize } from '@/lib/billing/enforce-tier'
import type {
  ImportChunkResponse,
  ImportRowWarning,
  ImportRowReason,
} from '@/lib/types/import'

// ── Limits ───────────────────────────────────────────────────
const CHUNK_MAX             = 500
const TOTAL_MAX             = 5000
const RATE_LIMIT_PER_HOUR   = 3
const RATE_WINDOW_MS        = 60 * 60 * 1000

// ── Request schema ───────────────────────────────────────────
const rowSchema = z.object({
  first_name:         z.string().optional(),
  last_name:          z.string().optional(),
  email:              z.string().optional(),
  phone:              z.string().optional(),
  source:             z.string().optional(),
  procedure_interest: z.array(z.string()).optional(),
  notes:              z.string().optional(),
}).strict()

const chunkSchema = z.object({
  import_id:     z.string().uuid().optional(),
  chunk_index:   z.number().int().min(0),
  total_rows:    z.number().int().min(1).max(TOTAL_MAX),
  dupe_strategy: z.enum(['skip', 'update']),
  source:        z.enum(['paste', 'csv']),
  rows:          z.array(rowSchema).max(CHUNK_MAX),
}).strict()

// ── Helpers ──────────────────────────────────────────────────

async function resolveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single()
  return data?.organization_id ?? null
}

function trimOrUndef(v: string | undefined | null): string | undefined {
  if (v == null) return undefined
  const t = String(v).trim()
  return t.length === 0 ? undefined : t
}

function unionArrays(a: string[] | null | undefined, b: string[] | null | undefined): string[] {
  const set = new Set<string>()
  for (const v of a ?? []) if (typeof v === 'string' && v.trim()) set.add(v.trim())
  for (const v of b ?? []) if (typeof v === 'string' && v.trim()) set.add(v.trim())
  return Array.from(set)
}

// ── POST /api/contacts/import ────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgId = await resolveOrgId(supabase, user.id)
  if (!orgId) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const bodyJson = await req.json().catch(() => null)
  const parsed = chunkSchema.safeParse(bodyJson)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return NextResponse.json({ error: firstError.message }, { status: 400 })
  }
  const body = parsed.data

  // ── Resolve or create the contact_imports row ─────────────
  let importId: string

  if (body.chunk_index === 0) {
    // Rate-limit: count imports started by this org in the last hour.
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
    const { count: recentCount, error: countErr } = await supabaseAdmin
      .from('contact_imports')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('started_at', since)

    if (countErr) {
      return NextResponse.json({ error: 'Failed to check rate limit' }, { status: 500 })
    }

    if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
      // Retry-After = seconds until the oldest in-window import ages out.
      // That's the moment the count drops below the limit, freeing a slot.
      // If the query returns nothing or a non-positive number (edge case —
      // clock skew, row vanished between count and fetch), floor to 60s.
      const { data: oldest } = await supabaseAdmin
        .from('contact_imports')
        .select('started_at')
        .eq('organization_id', orgId)
        .gte('started_at', since)
        .order('started_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      let retryAfter = 60
      if (oldest?.started_at) {
        const freeAtMs     = new Date(oldest.started_at).getTime() + RATE_WINDOW_MS
        const secondsLeft  = Math.ceil((freeAtMs - Date.now()) / 1000)
        if (secondsLeft > 60) retryAfter = secondsLeft
      }

      return NextResponse.json(
        { error: `Rate limit exceeded. Max ${RATE_LIMIT_PER_HOUR} imports per hour.` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }

    // Tier gate: block if the import requires bulk_import on a tier that
    // doesn't allow it, or if total_rows would push the org past maxContacts.
    // Only checked at chunk 0 — once an import is approved, subsequent chunks
    // proceed without re-checking (total_rows is committed at this point).
    const sizeCheck = await checkBulkImportSize(supabaseAdmin, orgId, body.total_rows)
    if (!sizeCheck.ok) {
      return NextResponse.json(sizeCheck.error, { status: sizeCheck.status })
    }

    const { data: created, error: createErr } = await supabaseAdmin
      .from('contact_imports')
      .insert({
        organization_id: orgId,
        user_id:         user.id,
        row_count:       body.total_rows,
        source:          body.source,
        status:          'processing',
      })
      .select('id')
      .single()

    if (createErr || !created) {
      return NextResponse.json({ error: 'Failed to start import' }, { status: 500 })
    }
    importId = created.id
  } else {
    if (!body.import_id) {
      return NextResponse.json(
        { error: 'import_id required for chunk_index > 0' },
        { status: 400 },
      )
    }
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('contact_imports')
      .select('id, organization_id, status')
      .eq('id', body.import_id)
      .single()

    if (existingErr || !existing) {
      return NextResponse.json({ error: 'Import not found' }, { status: 404 })
    }
    if (existing.organization_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // 'undone' gets its own branch ahead of the generic non-processing
    // check so the UI can show an informational, user-initiated message
    // ("you undid this yourself, here's what happened") rather than the
    // generic "already X" error. The wizard's partial-failure screen
    // relies on this to distinguish cancel-in-progress from crash.
    if (existing.status === 'undone') {
      return NextResponse.json(
        { error: 'Import was undone while in progress. Upload interrupted.' },
        { status: 409 },
      )
    }
    if (existing.status !== 'processing') {
      return NextResponse.json(
        { error: `Import is already ${existing.status}` },
        { status: 409 },
      )
    }
    importId = existing.id
  }

  // ── Normalize & validate rows ─────────────────────────────
  const warnings: ImportRowWarning[] = []
  const warn = (row_index: number, reason: ImportRowReason, detail?: string) =>
    warnings.push({ row_index, reason, detail })

  type Candidate = {
    row_index: number
    first_name: string
    last_name:  string | null
    email:      string | null
    phone:      string | null
    source:     string | null
    procedure_interest: string[] | null
    notes:      string | null
  }

  const candidates: Candidate[] = []

  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i]

    const first_name_raw = trimOrUndef(r.first_name)
    const last_name      = trimOrUndef(r.last_name)   ?? null
    const email_raw      = trimOrUndef(r.email)
    const phone_raw      = trimOrUndef(r.phone)
    const source         = trimOrUndef(r.source)      ?? null
    const notes          = trimOrUndef(r.notes)       ?? null

    const procedure_interest =
      (r.procedure_interest ?? [])
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter((p) => p.length > 0)

    // Skip totally empty rows (no identifier of any kind).
    if (!first_name_raw && !email_raw && !phone_raw) {
      warn(i, 'empty_row')
      continue
    }

    // Email: validate; on invalid, drop the email but keep the row.
    let email: string | null = null
    if (email_raw) {
      if (validateEmail(email_raw)) {
        email = email_raw.toLowerCase()
      } else {
        warn(i, 'invalid_email', email_raw)
      }
    }

    // Phone: normalize; on unparseable, drop the phone but keep the row, and
    // emit a warning so the clinic can see exactly which rows lost their phone.
    let phone: string | null = null
    if (phone_raw) {
      const normalized = normalizePhone(phone_raw)
      if (normalized) {
        phone = normalized
      } else {
        warn(i, 'invalid_phone', phone_raw)
      }
    }

    // first_name: required by schema. Fall back to 'Unknown' with a warning.
    let first_name = first_name_raw
    if (!first_name) {
      first_name = 'Unknown'
      warn(i, 'missing_first_name')
    }

    candidates.push({
      row_index: i,
      first_name,
      last_name,
      email,
      phone,
      source,
      procedure_interest: procedure_interest.length > 0 ? procedure_interest : null,
      notes,
    })
  }

  // ── In-paste dedupe (case-insensitive email) ──────────────
  // If the same email appears multiple times within this chunk, keep the first
  // and warn the rest. Rows without email pass through unchanged.
  const seenInPaste = new Set<string>()
  const postInPasteDupe: Candidate[] = []
  for (const c of candidates) {
    if (c.email) {
      if (seenInPaste.has(c.email)) {
        warn(c.row_index, 'duplicate_in_paste', c.email)
        continue
      }
      seenInPaste.add(c.email)
    }
    postInPasteDupe.push(c)
  }

  // ── Load existing contacts matching THIS chunk's emails ───
  // Scoped to chunk emails only — a whole-org scan per chunk would transfer
  // up to 100k rows over a 10-chunk import against a 10k-contact org.
  //
  // Two-pass strategy:
  //   1. Exact .in() on the lowercased list. Covers contacts stored with
  //      normalized (lowercased) email — the normal path for anything
  //      written after the import flow existed.
  //   2. For incoming emails still unmatched after pass 1, fall back to
  //      case-insensitive .or(ilike) to catch legacy rows stored with
  //      mixed case (e.g. "Sarah@Example.com" entered via the contact
  //      form before lowercasing was enforced). The partial unique index
  //      is on lower(email), so each mixed-case row still only matches
  //      one incoming email — no N^2 explosion.
  //
  // Per-chunk refetch naturally picks up rows inserted by earlier chunks
  // of this same import, which is what we want for retry idempotence.
  type ExistingRow = {
    id: string
    first_name: string
    last_name: string | null
    email: string | null
    phone: string | null
    source: string | null
    procedure_interest: string[] | null
    notes: string | null
  }

  const chunkEmails = postInPasteDupe
    .map((c) => c.email)
    .filter((e): e is string => e !== null)

  let existingRows: ExistingRow[] = []

  if (chunkEmails.length > 0) {
    // Pass 1: exact match on lowercased list.
    const { data: exactRows, error: exactErr } = await supabaseAdmin
      .from('contacts_active')
      .select('id, first_name, last_name, email, phone, source, procedure_interest, notes')
      .eq('organization_id', orgId)
      .in('email', chunkEmails)

    if (exactErr) {
      return NextResponse.json({ error: 'Failed to load existing contacts' }, { status: 500 })
    }
    existingRows = (exactRows ?? []) as ExistingRow[]

    // Pass 2: case-insensitive fallback for incoming emails not yet matched.
    const matched = new Set(
      existingRows.map((r) => (r.email ?? '').toLowerCase()),
    )
    const unmatched = chunkEmails.filter((e) => !matched.has(e))

    if (unmatched.length > 0) {
      // Escape ILIKE wildcards (%, _) and backslash so an email like
      // "a%b@x.com" can't do unintended pattern matching. Wrap in double
      // quotes so emails containing PostgREST-reserved chars (',', '.',
      // '(', ')') can't break the .or() parser.
      const escape = (s: string) =>
        s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')

      const orExpr = unmatched
        .map((e) => `email.ilike."${escape(e)}"`)
        .join(',')

      const { data: ciRows, error: ciErr } = await supabaseAdmin
        .from('contacts_active')
        .select('id, first_name, last_name, email, phone, source, procedure_interest, notes')
        .eq('organization_id', orgId)
        .or(orExpr)

      if (ciErr) {
        return NextResponse.json(
          { error: 'Failed to load existing contacts (case-insensitive pass)' },
          { status: 500 },
        )
      }
      existingRows = existingRows.concat((ciRows ?? []) as ExistingRow[])
    }
  }

  const existingByEmail = new Map<string, ExistingRow>()
  for (const row of existingRows) {
    if (row.email) existingByEmail.set(row.email.toLowerCase(), row)
  }

  // ── Partition into insert / update / skip ─────────────────
  type InsertShape = {
    organization_id: string
    first_name: string
    last_name: string | null
    email: string | null
    phone: string | null
    source: string | null
    procedure_interest: string[] | null
    notes: string | null
    import_id: string
    last_activity_at: string
  }
  type UpdateOp = { id: string; patch: Record<string, any> }

  const toInsert: InsertShape[] = []
  const toUpdate: UpdateOp[] = []
  let skipped = 0

  const nowIso = new Date().toISOString()

  for (const c of postInPasteDupe) {
    const match = c.email ? existingByEmail.get(c.email) : undefined

    if (match) {
      if (body.dupe_strategy === 'skip') {
        warn(c.row_index, 'existing_contact_skipped', c.email ?? undefined)
        skipped++
        continue
      }

      // strategy === 'update' — fill-if-empty for scalars, union for procedures.
      // Strictly coalesce(nullif(existing, ''), incoming): only overwrite when
      // existing is null or empty/whitespace. Do NOT treat 'Unknown' as a
      // sentinel — it's a real name in some cultures, and clinics can edit
      // manually if they care.
      const patch: Record<string, any> = {}
      if ((!match.first_name || match.first_name.trim() === '') && c.first_name) {
        patch.first_name = c.first_name
      }
      if ((!match.last_name || match.last_name.trim() === '') && c.last_name) {
        patch.last_name = c.last_name
      }
      if ((!match.phone || match.phone.trim() === '') && c.phone) {
        patch.phone = c.phone
      }
      if ((!match.source || match.source.trim() === '') && c.source) {
        patch.source = c.source
      }
      if ((!match.notes || match.notes.trim() === '') && c.notes) {
        patch.notes = c.notes
      }
      if (c.procedure_interest && c.procedure_interest.length > 0) {
        const merged = unionArrays(match.procedure_interest, c.procedure_interest)
        if (merged.length !== (match.procedure_interest?.length ?? 0)) {
          patch.procedure_interest = merged
        }
      }

      // Always bump last_activity_at when an import touches a row.
      patch.last_activity_at = nowIso

      toUpdate.push({ id: match.id, patch })
      continue
    }

    toInsert.push({
      organization_id:    orgId,
      first_name:         c.first_name,
      last_name:          c.last_name,
      email:              c.email,
      phone:              c.phone,
      source:             c.source,
      procedure_interest: c.procedure_interest,
      notes:              c.notes,
      import_id:          importId,
      last_activity_at:   nowIso,
    })
  }

  // ── Apply inserts (via RPC for ON CONFLICT DO NOTHING) ────
  // Routed through bulk_insert_contacts_ignore_dupes (migration
  // 20260422160000) instead of supabase-js .insert(), because a single
  // partial-index collision in a plain bulk insert fails the whole
  // batch and returns 500. The RPC swallows collisions per-row so one
  // weird edge-case row (case variant the two-pass dedupe missed,
  // concurrent import race, whitespace drift) can't take down the
  // other 499 rows in the chunk.
  //
  // Silent skips — rows that reached INSERT but were dropped by the
  // unique index — surface as a single chunk-level warning with
  // row_index=-1 and are counted against the chunk's skipped tally.
  // The driver does not tell us which specific rows collided, so we
  // can't attribute to individual row_index values.
  let imported = 0
  if (toInsert.length > 0) {
    const { data: rpcResult, error: insertErr } = await supabaseAdmin.rpc(
      'bulk_insert_contacts_ignore_dupes',
      {
        p_org_id:    orgId,
        p_import_id: importId,
        p_rows:      toInsert,
      },
    )

    if (insertErr) {
      return NextResponse.json(
        { error: `Failed to insert contacts: ${insertErr.message}` },
        { status: 500 },
      )
    }

    const first = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
    imported = (first?.inserted_count as number | undefined) ?? 0
    const silentSkips = (first?.skipped_count as number | undefined) ?? 0

    if (silentSkips > 0) {
      warnings.push({
        row_index: -1,
        reason:    'silent_dupe_skipped',
        detail:    `${silentSkips} row(s) dropped by DB-level dedupe (case variant or concurrent import).`,
      })
      skipped += silentSkips
    }
  }

  // ── Apply updates (one per row) ───────────────────────────
  let updated = 0
  for (const op of toUpdate) {
    const { error: updErr } = await supabaseAdmin
      .from('contacts')
      .update(op.patch)
      .eq('id', op.id)
      .eq('organization_id', orgId)
    if (updErr) {
      return NextResponse.json(
        { error: `Failed to update contact: ${updErr.message}` },
        { status: 500 },
      )
    }
    updated++
  }

  // ── Finalize (last chunk only) ────────────────────────────
  // Chunks 0..N-1 do NOT touch contact_imports counters. That avoids the
  // read-modify-write race: if a chunk's response never reached the client
  // and the client retries, the DB would have double-counted.
  //
  // The last chunk derives imported_count from count(*) WHERE import_id=X,
  // which is idempotent — re-running the last chunk lands the same number
  // (the same contact rows, just touched again by idempotent upserts/updates).
  //
  // skipped_count is approximated as total_rows - imported_count; it can be
  // off by up to the number of "update" operations (since updates also
  // count against total_rows but don't create import_id-tagged rows). The
  // exact per-chunk breakdown lives in each chunk's HTTP response and in
  // activity_log metadata from the client.
  const processedSoFar = body.chunk_index * CHUNK_MAX + body.rows.length
  const isLastChunk    = processedSoFar >= body.total_rows

  if (isLastChunk) {
    const { count: insertedTotal, error: countErr } = await supabaseAdmin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('import_id', importId)

    if (countErr) {
      return NextResponse.json({ error: 'Failed to finalize import' }, { status: 500 })
    }

    const importedFinal = insertedTotal ?? 0
    const skippedFinal  = Math.max(0, body.total_rows - importedFinal)

    const { error: patchErr } = await supabaseAdmin
      .from('contact_imports')
      .update({
        imported_count: importedFinal,
        skipped_count:  skippedFinal,
        status:         'completed',
        completed_at:   new Date().toISOString(),
      })
      .eq('id', importId)

    if (patchErr) {
      return NextResponse.json({ error: 'Failed to finalize import' }, { status: 500 })
    }

    await supabaseAdmin.from('activity_log').insert({
      organization_id: orgId,
      user_id:         user.id,
      action:          'contacts_imported',
      metadata: {
        import_id:    importId,
        row_count:    body.total_rows,
        imported:     importedFinal,
        skipped:      skippedFinal,
        source:       body.source,
      },
    })
  }

  const response: ImportChunkResponse = {
    import_id:   importId,
    chunk_index: body.chunk_index,
    imported,
    updated,
    skipped,
    warnings,
    complete:    isLastChunk,
  }

  return NextResponse.json(response)
}
