import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/contacts/[id]/messages
 *
 * Thin read endpoint that powers the Inbox conversation pane on /leads.
 * Mirrors the messages query already used server-side in
 * /leads/[id]/page.tsx — moved into an API route so the client-side
 * inbox can poll for new messages on the selected contact without a
 * full page navigation.
 *
 * Org-isolation is enforced two ways:
 *   1. RLS on the messages table (org_isolation policy).
 *   2. Explicit pre-check that the contact belongs to the caller's org,
 *      so a 404 is returned for cross-org IDs instead of an empty list
 *      (which would look like an empty conversation).
 *
 * Also opportunistically updates the contact's messages_last_seen_at so
 * the inbox row unread-indicator clears the same way it does on the
 * /leads/[id] page. Fire-and-forget — a failure here doesn't break the
 * response.
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

  // Confirm contact belongs to caller's org. Belt-and-suspenders with RLS.
  const { data: contact } = await supabase
    .from('contacts_active')
    .select('id')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single()
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, channel, direction, status, subject, body, sequence_step_id, sent_at, created_at')
    .eq('contact_id', id)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mark conversation seen (fire-and-forget). Same pattern as
  // /leads/[id] server component.
  void supabase
    .from('contacts')
    .update({ messages_last_seen_at: new Date().toISOString() })
    .eq('id', id)
    .then(({ error: updErr }) => {
      if (updErr) console.error('[contacts/[id]/messages] mark-as-seen failed:', updErr.message)
    })

  return NextResponse.json({ messages: messages ?? [] })
}
