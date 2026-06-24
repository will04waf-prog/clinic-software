import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/contacts/[id]/pending-draft
 *
 * Returns the most recent state='pending' AI draft for this contact,
 * or { draft: null } if there isn't one. Called by the conversation
 * pane when it opens a thread so the composer can pre-fill with an
 * AI suggestion.
 *
 * Org isolation enforced by RLS on ai_drafts + an explicit
 * organization_id match through the profiles → contacts_active
 * chain (same pattern as /api/contacts/[id]/messages).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
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

  // Cross-org guard: the contact has to belong to caller's org.
  const { data: contact } = await supabase
    .from('contacts_active')
    .select('id')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single()
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  // Quiet-hours scheduling: hide drafts whose `available_after` is
  // still in the future. NULL = immediately visible (existing W1+W2
  // behavior). The column ships in select(...) too so a future "next
  // available at HH:MM" UI hint doesn't need a new endpoint.
  const nowIso = new Date().toISOString()
  const { data: draft, error } = await supabase
    .from('ai_drafts')
    .select('id, draft_body, draft_subject, channel, model, trigger_message_id, generated_at, available_after')
    .eq('contact_id', id)
    .eq('state', 'pending')
    .or(`available_after.is.null,available_after.lte.${nowIso}`)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[pending-draft] query error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ draft: draft ?? null })
}
