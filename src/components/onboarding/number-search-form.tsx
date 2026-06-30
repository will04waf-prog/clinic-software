/**
 * Phase 5 M3 — area-code search form for the phone-number onboarding
 * wizard.
 *
 * Why a dedicated component (not inline in the page):
 *   - The search step has its own state (results list, loading, error)
 *     and an explicit lifecycle handoff to the brand-registration step.
 *     Splitting it out keeps the parent wizard component free to focus
 *     on step coordination.
 *   - The "Buy this number" button doesn't actually buy — it lifts the
 *     selected E.164 up to the wizard, which then renders the brand
 *     form. Keeping that flow local to the parent component avoids
 *     prop-drilling provisioning state into the search results list.
 *
 * Validation: area code is enforced as 3 digits at the input layer so
 * the action call is never made on bad input. The action also revalidates
 * (defense-in-depth) but UX latency is much better if we catch it here.
 */

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { searchNumbersAction } from '@/app/onboarding/phone-number/actions'
import { type NumberSearchResult } from '@/app/onboarding/phone-number/steps'

interface NumberSearchFormProps {
  onSelect: (e164: string) => void
}

export function NumberSearchForm({ onSelect }: NumberSearchFormProps) {
  const [areaCode, setAreaCode] = useState('')
  const [country, setCountry] = useState<'US' | 'CA'>('US')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<NumberSearchResult[] | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResults(null)

    if (!/^\d{3}$/.test(areaCode)) {
      setError('Area code must be 3 digits (e.g. 415)')
      return
    }

    setLoading(true)
    const r = await searchNumbersAction({ areaCode, country })
    setLoading(false)

    if (!r.ok) {
      setError(r.error)
      return
    }
    if (r.numbers.length === 0) {
      setError(`No numbers available in area code ${areaCode}. Try a nearby one.`)
      return
    }
    setResults(r.numbers)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-3 sm:items-end">
          <div>
            <Label htmlFor="area-code" className="mb-1.5 block">
              Area code
            </Label>
            <Input
              id="area-code"
              inputMode="numeric"
              maxLength={3}
              placeholder="e.g. 415"
              value={areaCode}
              onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
              autoComplete="off"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              3-digit US or Canadian area code.
            </p>
          </div>
          <div>
            <Label htmlFor="country" className="mb-1.5 block">
              Country
            </Label>
            <select
              id="country"
              value={country}
              onChange={e => setCountry(e.target.value as 'US' | 'CA')}
              className="flex h-9 w-full rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <option value="US">US</option>
              <option value="CA">CA</option>
            </select>
          </div>
          <Button type="submit" disabled={loading} className="h-9 sm:h-9">
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
      </form>

      {results && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
            {results.length} available
          </p>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {results.map(n => (
              <li
                key={n.e164}
                className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <div className="font-mono text-sm text-gray-900">{n.e164}</div>
                  <div className="text-xs text-gray-500">{n.friendly_name}</div>
                  <div className="mt-1 flex gap-1.5">
                    <CapabilityBadge enabled={n.capabilities?.voice ?? false} label="Voice" />
                    <CapabilityBadge enabled={n.capabilities?.sms   ?? false} label="SMS"   />
                    <CapabilityBadge enabled={n.capabilities?.mms   ?? false} label="MMS"   />
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onSelect(n.e164)}
                  disabled={!(n.capabilities?.voice) || !(n.capabilities?.sms)}
                  title={
                    !(n.capabilities?.voice) || !(n.capabilities?.sms)
                      ? 'This number lacks Voice or SMS — pick another.'
                      : 'Continue to brand registration'
                  }
                >
                  Buy this number
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">
            We require both Voice and SMS on the same number — the AI
            receptionist places calls AND sends reminder texts from it.
          </p>
        </div>
      )}
    </div>
  )
}

function CapabilityBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ' +
        (enabled
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          : 'bg-gray-50 text-gray-400 border border-gray-200 line-through')
      }
      title={enabled ? `${label} enabled` : `${label} unavailable`}
    >
      {label}
    </span>
  )
}
