import { Phone, PhoneIncoming, PhoneOutgoing, Clock, AlertTriangle, Activity } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * Top-of-page metadata block for a single call_logs row. Pure display
 * — no mutations. Renders the caller / clinic / duration / outcome /
 * intent badges + a safety alert when the agent flagged the call.
 *
 * All time formatting goes through the clinic IANA tz that the page
 * server-component looked up; this component is server-renderable
 * (no client state, no event handlers).
 */

interface Props {
  fromE164:           string
  toE164:             string
  direction:          'inbound' | 'outbound'
  startedAt:          string | null
  endedAt:            string | null
  durationSec:        number | null
  intent:             string | null
  outcome:            string
  safetyTriggerLabel: string | null
  timezone:           string
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return raw
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function formatDuration(sec: number | null): string {
  if (sec == null || sec < 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

// Map outcome enum to badge variant. Mirrors the enum on call_logs
// (see 20260708120000_add_call_agent.sql).
function outcomeVariant(outcome: string): 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline' {
  switch (outcome) {
    case 'completed':       return 'success'
    case 'transferred':     return 'default'
    case 'voicemail':       return 'secondary'
    case 'safety_handoff':  return 'destructive'
    case 'no_consent':      return 'warning'
    case 'agent_error':     return 'destructive'
    default:                return 'outline'
  }
}

export function CallMetadataCard({
  fromE164, toE164, direction, startedAt, durationSec,
  intent, outcome, safetyTriggerLabel, timezone,
}: Props) {
  const startedDisplay = startedAt
    ? new Date(startedAt).toLocaleString('en-US', {
        timeZone: timezone,
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : '—'

  const DirectionIcon = direction === 'outbound' ? PhoneOutgoing : PhoneIncoming
  const callerLabel  = direction === 'outbound' ? 'To'   : 'From'
  const clinicLabel  = direction === 'outbound' ? 'From' : 'To'

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DirectionIcon className="h-4 w-4 text-brand-600" />
              <span className="text-xs uppercase tracking-wide text-gray-500">
                {direction}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#14241d]">
              <span className="text-gray-500">{callerLabel}:</span>{' '}
              <span className="font-medium">{formatPhone(fromE164)}</span>
            </p>
            <p className="text-sm text-[#14241d]">
              <span className="text-gray-500">{clinicLabel}:</span>{' '}
              <span className="font-medium">{formatPhone(toE164)}</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge variant={outcomeVariant(outcome)}>{outcome.replace(/_/g, ' ')}</Badge>
            {intent && (
              <Badge variant="outline" className="capitalize">
                <Activity className="h-3 w-3 mr-1" />
                {intent}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {startedDisplay}
          </span>
          <span className="inline-flex items-center gap-1">
            <Phone className="h-3.5 w-3.5" />
            {formatDuration(durationSec)}
          </span>
        </div>

        {safetyTriggerLabel && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Safety flag raised on this call:{' '}
              <span className="font-medium">{safetyTriggerLabel}</span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
