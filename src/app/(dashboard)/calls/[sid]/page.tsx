import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { CallMetadataCard } from '@/components/calls/call-metadata-card'
import { RecordingPlayer } from '@/components/calls/recording-player'
import { TranscriptRenderer } from '@/components/calls/transcript-renderer'
import { CallLanguageBadge } from '@/components/calls/call-language-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * /calls/[sid] — owner-only call transcript page (Phase 5 W2).
 *
 * The post-call summary email Layla sends owners contains a deep link
 * to this page (PHI-free email body; clinical content lives here behind
 * the org auth boundary). Before this page existed those emails 404'd
 * — that's what this commit fixes.
 *
 * Defense-in-depth:
 *   - page redirect if not owner (mirrors /voice-messages)
 *   - SELECT scoped by organization_id (in addition to RLS) so an owner
 *     of org A cannot pull a call sid belonging to org B even if they
 *     hand-craft the URL. RLS on call_logs already enforces this but
 *     the explicit predicate makes the contract obvious in the page
 *     code and survives accidental policy regressions.
 *
 * No new nav: the page is only reachable from the voice-messages card
 * (when a voicemail row carries a call_sid) and from the call-summary
 * email — by design, owners shouldn't browse a flat list of every call.
 */

// Next 15: params is async in route handlers + pages.
type PageProps = { params: Promise<{ sid: string }> }

export default async function CallTranscriptPage({ params }: PageProps) {
  const { sid } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/calls/${encodeURIComponent(sid)}`)

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id, is_active')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner' || profile?.is_active !== true) {
    redirect('/dashboard')
  }

  // Defense-in-depth: scope by org_id in addition to RLS. A bad/old
  // link or copy-paste of someone else's sid resolves to notFound()
  // rather than leaking that the sid exists in another tenant.
  const { data: call } = await supabase
    .from('call_logs')
    .select(
      'id, call_sid, from_e164, to_e164, direction, started_at, ended_at, duration_sec, intent, transcript, recording_url, recording_consent_obtained, safety_trigger_label, outcome, followup_summary, detected_language, is_urgent, urgency_reason'
    )
    .eq('call_sid', sid)
    .eq('organization_id', profile.organization_id as string)
    .maybeSingle()

  if (!call) notFound()

  // Clinic timezone for rendering started_at — fall back to ET so a
  // brand-new org without a tz set doesn't crash render.
  const { data: org } = await supabase
    .from('organizations')
    .select('name, timezone')
    .eq('id', profile.organization_id as string)
    .single()
  const tz = org?.timezone || 'America/New_York'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Call detail"
        subtitle={call.started_at ? new Date(call.started_at).toLocaleString('en-US', {
          timeZone: tz,
          month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true,
        }) : undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">
        <Link
          href="/voice-messages"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-600 transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to voice messages
        </Link>

        {/* Detected language + urgency (renders nothing for old/null rows). */}
        <CallLanguageBadge
          detectedLanguage={call.detected_language}
          isUrgent={call.is_urgent}
          urgencyReason={call.urgency_reason}
        />

        <CallMetadataCard
          fromE164={call.from_e164}
          toE164={call.to_e164}
          direction={call.direction as 'inbound' | 'outbound'}
          startedAt={call.started_at}
          endedAt={call.ended_at}
          durationSec={call.duration_sec}
          intent={call.intent}
          outcome={call.outcome as string}
          safetyTriggerLabel={call.safety_trigger_label}
          timezone={tz}
        />

        <RecordingPlayer
          url={call.recording_url}
          consentObtained={call.recording_consent_obtained}
        />

        {call.followup_summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-[#14241d]">
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">
                {call.followup_summary}
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-[#14241d]">
              Transcript
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TranscriptRenderer transcript={call.transcript} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
