/**
 * CRM-pivot LOOP — GET / PATCH /api/jobs.
 *
 * The SCHEDULE surface's data endpoint (and the dashboard's vertical
 * probe). Owner-authenticated, org-scoped: the authenticated user's
 * profile resolves the organization, and every read/write is filtered
 * to that org (RLS enforces it a second time server-side).
 *
 * GET  → { jobs: [...], context: { vertical, ownerLanguage, ownerName } }
 *        Jobs are the org's scheduled work, ordered by date. The
 *        `context` block lets the (client) loop dashboard learn the
 *        org's vertical + owner language + name without a second
 *        round-trip — there is no other client-reachable vertical
 *        source, so this endpoint (which already resolves the org)
 *        carries it.
 * PATCH → advance a single job's status (scheduled → in_progress →
 *        completed). Minimal: id + status only.
 *
 * Additive + landscaping-only in practice: med-spa orgs have no jobs,
 * so GET returns an empty list for them. Nothing here touches the
 * med-spa surfaces.
 */

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendReviewRequestForJob } from '@/lib/loop/review-request'
import { z } from 'zod'

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'canceled']),
})

/**
 * Resolve the authenticated user's org + owner context, or an error
 * response to short-circuit with. Shared by GET + PATCH.
 */
async function resolveOrg(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, organization_id, organizations(vertical, owner_language, name)')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) } as const
  }

  const org = (Array.isArray(profile.organizations)
    ? profile.organizations[0]
    : profile.organizations) as { vertical?: string | null; owner_language?: string | null; name?: string | null } | null

  return {
    orgId: profile.organization_id as string,
    vertical: org?.vertical ?? 'landscaping',
    ownerLanguage: org?.owner_language ?? 'es',
    ownerName: (profile.full_name as string | null) ?? org?.name ?? null,
  } as const
}

// ─── GET /api/jobs ────────────────────────────────────────────
export async function GET() {
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return ctx.error

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, title, scheduled_date, status, completed_at, contact:contacts(first_name)')
    .eq('organization_id', ctx.orgId)
    .order('scheduled_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Which jobs already got their review request — powers the "Reseña
  // pedida" chip on completed rows. Service-role read (activity_log has
  // no owner-facing RLS policy); org-scoped by the filter.
  const reviewRequested = new Set<string>()
  try {
    const { data: sent } = await supabaseAdmin
      .from('activity_log')
      .select('metadata')
      .eq('organization_id', ctx.orgId)
      .eq('action', 'review_request_sent')
    for (const row of sent ?? []) {
      const jobId = (row.metadata as { job_id?: string } | null)?.job_id
      if (jobId) reviewRequested.add(jobId)
    }
  } catch { /* chip is cosmetic — never fail the list */ }

  const normalized = (jobs ?? []).map((j: any) => {
    const contact = Array.isArray(j.contact) ? j.contact[0] : j.contact
    return {
      id: j.id,
      title: j.title,
      scheduled_date: j.scheduled_date,
      status: j.status,
      completed_at: j.completed_at,
      contact_first_name: contact?.first_name ?? null,
      review_requested: reviewRequested.has(j.id),
    }
  })

  return NextResponse.json({
    jobs: normalized,
    context: {
      vertical: ctx.vertical,
      ownerLanguage: ctx.ownerLanguage,
      ownerName: ctx.ownerName,
    },
  })
}

// ─── PATCH /api/jobs ──────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return ctx.error

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { id, status } = parsed.data
  const update: { status: string; completed_at?: string | null } = { status }
  // Stamp completed_at when the job closes; clear it if a completed
  // job is moved back to an open state.
  update.completed_at = status === 'completed' ? new Date().toISOString() : null

  const { data: updated, error } = await supabase
    .from('jobs')
    .update(update)
    .eq('id', id)
    .eq('organization_id', ctx.orgId)
    .select('id, title, scheduled_date, status, completed_at, contact_id, recurrence, recurrence_source_job_id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Recurring work: completing a weekly/biweekly/monthly job spawns the
  // next one automatically (a lawn is a repeating job). 'custom' recurs but
  // is created manually, so it does NOT auto-generate. Best-effort: a
  // failure here never fails the completion the owner just did.
  const AUTO: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 }
  if (status === 'completed' && updated.recurrence && updated.recurrence in AUTO) {
    try {
      const base = updated.scheduled_date ? new Date(updated.scheduled_date + 'T00:00:00Z') : new Date()
      const next = new Date(base)
      if (updated.recurrence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
      else next.setUTCDate(next.getUTCDate() + AUTO[updated.recurrence])
      await supabase.from('jobs').insert({
        organization_id: ctx.orgId,
        contact_id: updated.contact_id,
        title: updated.title,
        status: 'scheduled',
        scheduled_date: next.toISOString().slice(0, 10),
        recurrence: updated.recurrence,
        // Point the whole chain back to the original job.
        recurrence_source_job_id: updated.recurrence_source_job_id ?? updated.id,
      })
    } catch (e) {
      console.error('[jobs] recurring auto-generate failed:', e instanceof Error ? e.message : e)
    }
  }

  // Review request (star-gated Google review flow). Fire-and-forget:
  // no-ops unless the org has a Google Place ID configured, and dedupes
  // per job internally. Never delays or fails the completion response.
  if (status === 'completed') {
    after(() => sendReviewRequestForJob(ctx.orgId, updated.id))
  }

  return NextResponse.json({ job: updated })
}
