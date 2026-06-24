import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  VoiceProfileSchema,
  readVoiceProfile,
} from '@/lib/voice-profile'

/**
 * GET  /api/org/voice-profile — returns the current org's voice
 *      profile (with defaults filled in).
 * PATCH /api/org/voice-profile — partial update of the profile.
 *
 * Voice training is W6 plumbing. Drafts won't actually USE the
 * profile until W7 wires it into generateDraft(). Until then, this
 * is pure data collection.
 *
 * Org isolation: only the caller's org row is read/written.
 */

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: org, error } = await supabase
    .from('organizations')
    .select('ai_twin_voice_profile')
    .eq('id', profile.organization_id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ profile: readVoiceProfile(org?.ai_twin_voice_profile) })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = VoiceProfileSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Read the existing profile, merge the partial update on top. Lets
  // clients PATCH just one field (e.g. only banned_phrases) without
  // losing the others — matches the rest of the codebase's PATCH
  // semantics.
  const { data: existing } = await supabase
    .from('organizations')
    .select('ai_twin_voice_profile')
    .eq('id', profile.organization_id)
    .single()

  const current = readVoiceProfile(existing?.ai_twin_voice_profile)
  const merged = { ...current, ...parsed.data }

  const { error: updErr } = await supabase
    .from('organizations')
    .update({ ai_twin_voice_profile: merged })
    .eq('id', profile.organization_id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ profile: readVoiceProfile(merged) })
}
