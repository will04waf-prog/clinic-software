/**
 * POST /api/estimates/approve — CRM-pivot LOOP. PUBLIC (no auth).
 *
 * The client taps "Aprobar estimado" on /aprobar/[token]; this endpoint
 * flips the estimate to 'approved' and spins up the follow-on job. The
 * only credential is the single-purpose capability token in the body.
 *
 * SECURITY / CORRECTNESS:
 *   - Token is verified for the 'estimate_approve' purpose ONLY — a token
 *     minted for any other purpose can never approve an estimate.
 *   - The transition is ONE guarded UPDATE via the service-role client
 *     (the client has no session; RLS grants anon nothing). No
 *     read-then-write: the `status in (sent,viewed)` predicate is the
 *     race guard, so two concurrent taps flip the row once and only one
 *     request creates the job.
 *   - approved_at + approved_ip are stamped on the row for the audit trail.
 *   - Idempotent: a double-tap (or a re-tap after approval) matches no
 *     row and returns { ok, alreadyApproved } WITHOUT creating a 2nd job.
 */
import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCapabilityToken } from '@/lib/tokens/capability-token'
import { ipFor } from '@/lib/booking/public-rate-limit'
import { notifyClient } from '@/lib/notify/client'
import { resolveLocale } from '@/lib/i18n'

// Ensure a scheduled job exists for an approved estimate. Idempotent:
// on-conflict-do-nothing against the unique(estimate_id) index, so a
// retry / self-heal / concurrent tap never creates a second job.
async function ensureJob(est: { id: string; organization_id: string; contact_id: string; title: string | null; recurrence?: string | null }): Promise<void> {
  const { error } = await supabaseAdmin
    .from('jobs')
    .upsert(
      {
        organization_id: est.organization_id,
        estimate_id: est.id,
        contact_id: est.contact_id,
        title: est.title || 'Trabajo',
        status: 'scheduled',
        recurrence: est.recurrence ?? null,
      },
      { onConflict: 'estimate_id', ignoreDuplicates: true },
    )
  if (error) console.error('[estimates/approve] job upsert failed:', error.message)
}

export async function POST(req: NextRequest) {
  const ip = ipFor(req)

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const token = typeof (body as { token?: unknown })?.token === 'string'
    ? (body as { token: string }).token
    : ''

  const estimateId = verifyCapabilityToken('estimate_approve', token)
  if (!estimateId) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 })
  }

  const nowIso = new Date().toISOString()
  // Single guarded UPDATE = the whole transition + the race guard. Only a
  // row currently in 'sent'/'viewed' matches; the row-level lock means a
  // concurrent double-tap flips exactly once.
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('estimates')
    .update({ status: 'approved', approved_at: nowIso, approved_ip: ip })
    .eq('id', estimateId)
    .in('status', ['sent', 'viewed'])
    .select('id, organization_id, contact_id, title, recurrence')
    .maybeSingle()

  if (updateErr) {
    return NextResponse.json({ error: 'approve_failed' }, { status: 500 })
  }
  if (!updated) {
    // Already approved / expired / void / never sent. Idempotent. But if
    // a PRIOR approval flipped the row and its job insert failed (the
    // two are separate statements), self-heal: ensure the job exists for
    // an already-approved estimate. The unique(estimate_id) index makes
    // this a safe no-op when the job is already there.
    const { data: existing } = await supabaseAdmin
      .from('estimates')
      .select('id, organization_id, contact_id, title, status, recurrence')
      .eq('id', estimateId)
      .maybeSingle()
    if (existing?.status === 'approved') await ensureJob(existing)
    return NextResponse.json({ ok: true, alreadyApproved: true })
  }

  // Create the follow-on job. Idempotent via the unique(estimate_id)
  // index — a retry or the self-heal path above can never double-create.
  await ensureJob(updated)

  // Best-effort "approved" confirmation to the client. Off the response
  // path — the approval already succeeded and must not depend on delivery.
  after(async () => {
    try {
      const [{ data: org }, { data: contact }] = await Promise.all([
        supabaseAdmin.from('organizations').select('name').eq('id', updated.organization_id).single(),
        supabaseAdmin.from('contacts').select('first_name, phone, preferred_language').eq('id', updated.contact_id).single(),
      ])
      if (!contact?.phone) return
      const lang = resolveLocale(contact.preferred_language)
      const businessName = org?.name || 'Tarhunna'
      const firstName = contact.first_name || ''
      const smsBody = lang === 'es'
        ? `¡Gracias ${firstName}! Su aprobación del estimado de ${businessName} quedó confirmada.`
        : `Thanks ${firstName}! Your approval of ${businessName}'s estimate is confirmed.`
      await notifyClient({
        orgId: updated.organization_id,
        toPhone: contact.phone,
        lang,
        templateType: 'estimate_approved',
        variables: [firstName, businessName],
        smsBody,
        link: '',
      })
    } catch (err) {
      console.error('[estimates/approve] approved-notify failed:', err instanceof Error ? err.message : err)
    }
  })

  return NextResponse.json({ ok: true })
}
