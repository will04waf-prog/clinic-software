import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireCapability } from '@/lib/billing/require-tier'

/**
 * DELETE /api/org/voice-examples/[id] — remove one example.
 * Org isolation enforced by RLS + an explicit org check on the
 * matching row before the DELETE issues.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const gate = await requireCapability(supabase, profile.organization_id, 'allowsVoiceTraining')
  if (!gate.ok) return gate.response

  const { data: existing } = await supabase
    .from('voice_examples')
    .select('id, organization_id')
    .eq('id', id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Example not found' }, { status: 404 })
  if (existing.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Example not found' }, { status: 404 })
  }

  const { error: delErr } = await supabase.from('voice_examples').delete().eq('id', id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
