import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Phone, AlertTriangle, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardContent } from '@/components/ui/card'
import { VoiceMessageCard, type VoiceMessage } from '@/components/voice-messages/voice-message-card'

export default async function VoiceMessagesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/voice-messages')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner') redirect('/dashboard')

  // Org name flows into each card so the inline ReplyForm can show
  // the prefix the patient will see in the outbound SMS body.
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', profile.organization_id as string)
    .single()
  const orgName = org?.name ?? 'Your clinic'

  const { data: messages } = await supabase
    .from('voice_messages')
    .select('id, caller_name, caller_phone, message_text, urgency, callback_preference, status, call_sid, created_at')
    .eq('organization_id', profile.organization_id as string)
    .order('created_at', { ascending: false })
    .limit(200)

  const all   = (messages ?? []) as VoiceMessage[]
  const open  = all.filter(m => m.status === 'open')
  const done  = all.filter(m => m.status === 'resolved')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Voice messages"
        subtitle="Messages Layla took on calls she couldn't fully resolve."
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#02C39A] transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>

        {/* Urgent open messages — surfaced at the top with red accent. */}
        {open.some(m => m.urgency === 'urgent') && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              You have {open.filter(m => m.urgency === 'urgent').length} urgent message{open.filter(m => m.urgency === 'urgent').length === 1 ? '' : 's'} waiting.
            </span>
          </div>
        )}

        <section>
          <h2 className="text-sm font-medium text-gray-900 mb-3">
            Open <span className="text-gray-400">({open.length})</span>
          </h2>
          {open.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-gray-500 flex items-center gap-2">
                <Phone className="h-4 w-4" />
                No open messages. New ones from Layla land here.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {open.map(m => (
                <VoiceMessageCard
                  key={m.id}
                  message={m}
                  orgName={orgName}
                />
              ))}
            </div>
          )}
        </section>

        {done.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-gray-900 mb-3">
              Resolved <span className="text-gray-400">({done.length})</span>
            </h2>
            <div className="space-y-3 opacity-70">
              {done.slice(0, 20).map(m => (
                <VoiceMessageCard
                  key={m.id}
                  message={m}
                  orgName={orgName}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
