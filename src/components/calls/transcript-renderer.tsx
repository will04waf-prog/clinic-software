/**
 * Renders the JSONB transcript that Vapi POSTed to /api/webhooks/vapi/call-end.
 *
 * Vapi's transcript shape (as observed in their end-of-call-report
 * payload) is an array of turn objects like:
 *
 *   [
 *     { role: 'assistant', message: 'Hi, this is Layla...',  time: 0,    secondsFromStart: 0.1, ... },
 *     { role: 'user',      message: 'I need to reschedule.', time: 4123, secondsFromStart: 4.1, ... },
 *     ...
 *   ]
 *
 * The column is JSONB (unknown at the TS layer) so we narrow defensively:
 *  - if the payload is an array of turn-shaped objects, render the timeline
 *  - if it's a plain string (some Vapi modes emit a single multi-line
 *    transcript string), render in a pre block
 *  - otherwise show a "no transcript" empty state rather than throwing
 *
 * PHI lives in the transcript. The page is owner-only + org-scoped so
 * this component does not have to scrub it, but we MUST NOT log it
 * (no console.log of the transcript shape during debugging — keep
 * any diagnostics behind explicit dev-only flags upstream).
 *
 * No emojis. The role label is a short prefix the owner can scan.
 */

type Turn = {
  role:    'user' | 'assistant' | 'system' | 'tool' | string
  message: string
  // secondsFromStart is the canonical timing field; `time` (ms) and
  // `endTime` are also seen in older payloads. We accept whichever
  // is present and skip rendering a timestamp if neither is.
  secondsFromStart?: number
  time?:             number
}

function isTurn(x: unknown): x is Turn {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.role === 'string' && typeof o.message === 'string'
}

function isTurnArray(x: unknown): x is Turn[] {
  return Array.isArray(x) && x.length > 0 && x.every(isTurn)
}

function formatOffset(turn: Turn): string | null {
  // Prefer secondsFromStart (Vapi's documented field). Fall back to
  // `time` interpreted as ms-since-call-start if no seconds available.
  let sec: number | null = null
  if (typeof turn.secondsFromStart === 'number' && isFinite(turn.secondsFromStart)) {
    sec = turn.secondsFromStart
  } else if (typeof turn.time === 'number' && isFinite(turn.time)) {
    sec = turn.time / 1000
  }
  if (sec == null) return null
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function roleStyles(role: string): { label: string; cls: string } {
  switch (role) {
    case 'assistant':
      return { label: 'Layla', cls: 'bg-brand-50 border-brand-200 text-[#14241d]' }
    case 'user':
      return { label: 'Caller', cls: 'bg-white border-gray-200 text-gray-800' }
    case 'tool':
      return { label: 'Tool',   cls: 'bg-gray-50 border-gray-200 text-gray-600 italic' }
    case 'system':
      return { label: 'System', cls: 'bg-gray-50 border-gray-200 text-gray-500 italic' }
    default:
      return { label: role,     cls: 'bg-white border-gray-200 text-gray-800' }
  }
}

export function TranscriptRenderer({ transcript }: { transcript: unknown }) {
  if (transcript == null) {
    return <p className="text-sm text-gray-500">No transcript captured for this call.</p>
  }

  if (typeof transcript === 'string') {
    // Some Vapi runs emit a single string — render as-is so we don't
    // hide it from the owner just because it's the wrong shape.
    return (
      <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">
        {transcript}
      </pre>
    )
  }

  if (!isTurnArray(transcript)) {
    return (
      <p className="text-sm text-gray-500">
        Transcript stored in an unexpected format — open the raw call record if you
        need the original content.
      </p>
    )
  }

  return (
    <ol className="space-y-3">
      {transcript.map((turn, idx) => {
        const { label, cls } = roleStyles(turn.role)
        const offset = formatOffset(turn)
        return (
          <li key={idx} className={`rounded-lg border p-3 ${cls}`}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-xs font-medium uppercase tracking-wide">
                {label}
              </span>
              {offset && (
                <span className="text-[10px] tabular-nums text-gray-400">
                  {offset}
                </span>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap">{turn.message}</p>
          </li>
        )
      })}
    </ol>
  )
}
