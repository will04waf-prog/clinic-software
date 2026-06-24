import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

/**
 * GET   /api/org/voice-examples — list all voice examples for the
 *       caller's org (newest first).
 * POST  /api/org/voice-examples — add an example. Body: { class,
 *       label?, body }. Soft cap of 30 per org so we don't blow out
 *       few-shot prompt budgets later.
 *
 * Per-example DELETE lives in /api/org/voice-examples/[id]/route.ts.
 */

const VALID_CLASSES = ['greeting', 'faq', 'follow_up', 'consult_confirm', 'follow_up_cold', 'custom'] as const
const MAX_EXAMPLES_PER_ORG = 30

const CreateSchema = z.object({
  class: z.enum(VALID_CLASSES),
  label: z.string().max(80).nullable().optional(),
  body:  z.string().min(1).max(600),
})

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: examples, error } = await supabase
    .from('voice_examples')
    .select('id, class, label, body, created_at, updated_at')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ examples: examples ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = CreateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Cap check — count + insert is a TOCTOU race in theory, but the
  // cap is a soft UX limit not a security boundary. Acceptable.
  const { count } = await supabase
    .from('voice_examples')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', profile.organization_id)
  if ((count ?? 0) >= MAX_EXAMPLES_PER_ORG) {
    return NextResponse.json({
      error: 'limit_reached',
      message: `You can store up to ${MAX_EXAMPLES_PER_ORG} voice examples. Delete an older one to add a new one.`,
    }, { status: 400 })
  }

  const { data: inserted, error: insErr } = await supabase
    .from('voice_examples')
    .insert({
      organization_id: profile.organization_id,
      class:           parsed.data.class,
      label:           parsed.data.label ?? null,
      body:            parsed.data.body,
      created_by:      user.id,
    })
    .select('id, class, label, body, created_at, updated_at')
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ example: inserted }, { status: 201 })
}
