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
import { createClient } from '@/lib/supabase/server'
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
    vertical: org?.vertical ?? 'medspa',
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

  const normalized = (jobs ?? []).map((j: any) => {
    const contact = Array.isArray(j.contact) ? j.contact[0] : j.contact
    return {
      id: j.id,
      title: j.title,
      scheduled_date: j.scheduled_date,
      status: j.status,
      completed_at: j.completed_at,
      contact_first_name: contact?.first_name ?? null,
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
    .select('id, title, scheduled_date, status, completed_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json({ job: updated })
}
