'use client'

/**
 * Phase 5 W2 — Clinic address sub-section for /settings/call-agent.
 *
 * Backs the organizations.address_line1..directions_notes columns
 * added in 20260710090000_add_org_address.sql. These feed Layla's
 * give_directions tool — when the caller asks "where are you located?"
 * the tool reads city/region/postal_code aloud and follows up with
 * an SMS containing a Google Maps link (built from google_place_id
 * when present, else the address lines).
 *
 * Save flow uses the updateClinicAddress server action rather than a
 * PATCH endpoint — this surface is read-once / write-once per visit
 * and benefits from co-locating the validation + revalidatePath in
 * one place.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateClinicAddress } from '@/app/(dashboard)/settings/call-agent/actions'

export interface ClinicAddressInitial {
  address_line1:    string | null
  address_line2:    string | null
  city:             string | null
  region:           string | null
  postal_code:      string | null
  country_code:     string | null
  google_place_id:  string | null
  directions_notes: string | null
}

type FieldState = Record<keyof ClinicAddressInitial, string>

function toFieldState(initial: ClinicAddressInitial): FieldState {
  return {
    address_line1:    initial.address_line1    ?? '',
    address_line2:    initial.address_line2    ?? '',
    city:             initial.city             ?? '',
    region:           initial.region           ?? '',
    postal_code:      initial.postal_code      ?? '',
    country_code:     initial.country_code     ?? '',
    google_place_id:  initial.google_place_id  ?? '',
    directions_notes: initial.directions_notes ?? '',
  }
}

export function ClinicAddressCard({ initial }: { initial: ClinicAddressInitial }) {
  const router = useRouter()
  const [fields, setFields] = useState<FieldState>(() => toFieldState(initial))
  const [error, setError]   = useState<string | null>(null)
  const [saved, setSaved]   = useState(false)
  const [pending, startTransition] = useTransition()

  // Re-sync the draft from server-supplied props whenever `initial`
  // changes (i.e. after a successful save + router.refresh() roundtrip).
  // updateClinicAddress normalizes inputs server-side (uppercases the
  // ISO country code, trims whitespace, etc.); without this rehydrate
  // the user's NEXT edit would operate on whatever they typed locally,
  // not the canonical normalized values — they'd see "us" in the input
  // even though the DB now holds "US", and a subsequent partial edit
  // could silently overwrite the normalization. Mirrors the
  // FallbackInput / GreetingInput pattern in call-agent-settings-card.
  useEffect(() => { setFields(toFieldState(initial)) }, [initial])

  function set<K extends keyof FieldState>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function onSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateClinicAddress(fields)
      if (!result.ok) {
        setError(result.error)
      } else {
        setSaved(true)
        // Pull the now-normalized row back from the server so the
        // useEffect above can rehydrate the draft from canonical values.
        // Without this refresh, props stay stale until the user
        // navigates away and back, which is exactly the window where
        // their next edit happens on a divergent draft.
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-brand-600" />
          Clinic address
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-gray-500">
          Used by the AI agent's directions tool. When a caller asks how to get to the clinic, the agent reads this address aloud and can text a Google Maps link. Leave blank to have the agent politely decline the question.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="address_line1">Address line 1</Label>
          <Input
            id="address_line1"
            placeholder="123 Main Street"
            value={fields.address_line1}
            disabled={pending}
            onChange={(e) => set('address_line1', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="address_line2">Address line 2</Label>
          <Input
            id="address_line2"
            placeholder="Suite 204"
            value={fields.address_line2}
            disabled={pending}
            onChange={(e) => set('address_line2', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              placeholder="Austin"
              value={fields.city}
              disabled={pending}
              onChange={(e) => set('city', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="region">State / region</Label>
            <Input
              id="region"
              placeholder="TX"
              value={fields.region}
              disabled={pending}
              onChange={(e) => set('region', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="postal_code">Postal code</Label>
            <Input
              id="postal_code"
              placeholder="78701"
              value={fields.postal_code}
              disabled={pending}
              onChange={(e) => set('postal_code', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country_code">Country code</Label>
            <Input
              id="country_code"
              placeholder="US"
              maxLength={2}
              value={fields.country_code}
              disabled={pending}
              onChange={(e) => set('country_code', e.target.value.toUpperCase())}
            />
            <p className="text-[11px] text-gray-500">ISO 3166-1 alpha-2 (US, CA, MX, ...).</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="google_place_id">Google Place ID (optional)</Label>
          <Input
            id="google_place_id"
            placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
            value={fields.google_place_id}
            disabled={pending}
            onChange={(e) => set('google_place_id', e.target.value)}
          />
          <p className="text-[11px] text-gray-500">
            When set, the directions SMS uses a deterministic Maps deep-link instead of geocoding the address each call.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="directions_notes">Directions notes (optional)</Label>
          <textarea
            id="directions_notes"
            placeholder="Park in the back lot, second entrance. Buzz #204 at the gate."
            value={fields.directions_notes}
            disabled={pending}
            onChange={(e) => set('directions_notes', e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
          />
          <p className="text-[11px] text-gray-500">
            Layla reads this verbatim at the end of the directions response — use it for parking, gate codes, the colour of the awning, anything a street address can't carry.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        {saved && !error && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Saved.
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={onSave} disabled={pending}>
            {pending ? 'Saving…' : 'Save address'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
