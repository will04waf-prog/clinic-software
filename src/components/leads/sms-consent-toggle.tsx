'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MessageSquareOff, ShieldCheck, AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  contactId: string
  smsConsent: boolean
  optedOutSms: boolean
}

/**
 * Inline control on the lead detail page that lets staff record persistent
 * SMS consent for a contact. Automation sequences gate sends on
 * sms_consent === true (TCPA-compliant); without an explicit grant they
 * silently skip the contact. This component is the only path to flip that
 * flag from the dashboard.
 *
 * Three visual states:
 *   - opted-out (red, no action — must unblock first)
 *   - granted  (green check — clicking opens a revoke confirmation)
 *   - pending  (amber — clicking opens a grant confirmation with attestation)
 *
 * Both grant and revoke require explicit attestation so they aren't
 * accidentally toggled. The PATCH route logs both actions to activity_log.
 */
export function SmsConsentToggle({ contactId, smsConsent, optedOutSms }: Props) {
  const router = useRouter()
  const [grantOpen, setGrantOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [attested, setAttested] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetTransient() {
    setAttested(false)
    setError(null)
    setSaving(false)
  }

  async function patch(payload: Record<string, unknown>, onDone: () => void) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      onDone()
      router.refresh()
    } catch (err: any) {
      setError(err.message ?? 'Failed to update consent')
    } finally {
      setSaving(false)
    }
  }

  // Opted-out is terminal — staff can't grant consent over an opt-out
  // without first clearing the opt-out (different action, lives elsewhere).
  if (optedOutSms) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-medium text-red-700">
        <MessageSquareOff className="h-3 w-3" />
        Opted out of SMS
      </div>
    )
  }

  return (
    <>
      {smsConsent ? (
        <button
          type="button"
          onClick={() => {
            resetTransient()
            setRevokeOpen(true)
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
          title="SMS consent on file — click to revoke"
        >
          <Check className="h-3 w-3" />
          SMS consent granted
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            resetTransient()
            setGrantOpen(true)
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
          title="No SMS consent on file — automations will skip this contact"
        >
          <AlertCircle className="h-3 w-3" />
          No SMS consent
        </button>
      )}

      {/* Grant dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Record SMS consent
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 leading-relaxed">
              Recording consent here marks this contact as eligible to receive
              automated SMS sequences (appointment reminders, follow-ups, etc).
              Only do this if you have <span className="font-semibold">actually
              collected</span> explicit consent from the contact — in person,
              on a paper intake form, by email, or recorded phone call.
            </p>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                disabled={saving}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                I confirm this contact has given me explicit consent to receive
                SMS messages from my clinic.
              </span>
            </label>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setGrantOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={() =>
                  patch({ sms_consent: true }, () => setGrantOpen(false))
                }
                disabled={!attested || saving}
              >
                {saving ? 'Saving…' : 'Record consent'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke dialog */}
      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke SMS consent?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 leading-relaxed">
              Automated SMS sequences will stop sending to this contact.
              Manual SMS from a staff member will still work but show a
              no-consent warning. Revoking is logged for compliance.
            </p>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setRevokeOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  patch({ sms_consent: false }, () => setRevokeOpen(false))
                }
                disabled={saving}
              >
                {saving ? 'Revoking…' : 'Revoke consent'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
