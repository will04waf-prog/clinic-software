'use client'

import { useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * HTML5 audio recording player.
 *
 * Three states this component handles:
 *  1. No URL stored on call_logs.recording_url  → 'No recording on file' (recording disabled,
 *     consent declined, or Vapi never produced one).
 *  2. URL stored but the asset is 404 / expired / forbidden → onError flips
 *     us to the same 'not available' copy rather than rendering a broken
 *     audio element. Vapi recording URLs are signed and can expire; the
 *     owner sees a clean state instead of a console error.
 *  3. URL present + loads → native <audio controls> playback.
 *
 * Recording consent context: when the call had consent_obtained=false
 * we still hide the player even if a url somehow exists, because the
 * compliance assumption is "no recording playback when consent flag is
 * false." The webhook already sets recording_url=null in the consent-
 * declined path, so this is a belt-and-suspenders guard.
 */

interface Props {
  url:             string | null
  consentObtained: boolean
}

export function RecordingPlayer({ url, consentObtained }: Props) {
  const [errored, setErrored] = useState(false)

  const available = !!url && consentObtained && !errored

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-[#14241d] flex items-center gap-2">
          {available ? <Mic className="h-4 w-4 text-brand-600" /> : <MicOff className="h-4 w-4 text-gray-400" />}
          Recording
        </CardTitle>
      </CardHeader>
      <CardContent>
        {available ? (
          <audio
            controls
            preload="metadata"
            src={url!}
            onError={() => setErrored(true)}
            className="w-full"
          >
            Your browser does not support audio playback.
          </audio>
        ) : (
          <p className="text-sm text-gray-500">
            {!consentObtained
              ? 'No recording — caller did not consent to recording on this call.'
              : 'No recording on file for this call.'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
