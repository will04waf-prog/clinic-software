/**
 * Phase 5 M3 — A2P 10DLC brand-registration form.
 *
 * Why this is required:
 *   - US carriers (post-March-2024) drop unregistered 10DLC SMS at the
 *     network level. Without a registered Brand + Campaign attached to
 *     the org's number, the appointment-reminder and intake-link texts
 *     simply won't deliver.
 *   - Twilio's TrustHub flow needs the full corporate identity
 *     (business name, EIN, address, authorized rep, sample message).
 *     We collect it once here so the M5 runner can register Brand +
 *     Campaign without the operator chasing the clinic for paperwork
 *     later.
 *
 * Why EIN is masked on screen (last-4 visible only when focused/typed):
 *   - The EIN is a tax-identifying number; shoulder-surfing in a busy
 *     clinic office is a real risk during onboarding. Masking the
 *     input puts the burden of accuracy on the typist instead of the
 *     room. The value is still sent in clear over TLS to our server
 *     (and stored in organizations.a2p_brand_data, which is RLS-gated
 *     to org members only).
 *   - We do NOT support paste-without-typing for the EIN since paste
 *     fills the input without focus, which would briefly show the
 *     full number. Paste is allowed but the masking covers it again
 *     once focus leaves.
 *
 * Why the vertical is a closed enum:
 *   - Twilio's A2P UseCases API expects a fixed taxonomy. We map our
 *     three clinic-relevant verticals (medical, aesthetic, wellness)
 *     to the corresponding TrustHub messaging_use_case at the M5
 *     register_a2p_campaign step. Free-form text here would lose at
 *     the API boundary.
 *
 * Submitting: lifts the validated payload up to the parent wizard,
 * which combines it with the previously-selected E.164 and calls
 * provisionNumberAction.
 */

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface BrandData {
  business_name:   string
  dba:             string | null
  ein:             string
  address_line1:   string
  address_line2:   string | null
  city:            string
  region:          string
  postal_code:     string
  country_code:    string
  website_url:     string
  business_email:  string
  business_phone:  string
  vertical:        'medical' | 'aesthetic' | 'wellness'
  sample_message:  string
}

interface BrandRegistrationFormProps {
  e164:                 string
  initial?:             Record<string, unknown> | null
  onSubmit:             (data: BrandData) => Promise<{ ok: boolean; error?: string }>
  onBack:               () => void
}

const VERTICAL_OPTIONS: Array<{ value: BrandData['vertical']; label: string; example: string }> = [
  { value: 'medical',   label: 'Medical practice',     example: 'OB/GYN, primary care, dental, etc.' },
  { value: 'aesthetic', label: 'Aesthetic / cosmetic', example: 'Med spa, dermatology, plastic surgery' },
  { value: 'wellness',  label: 'Wellness',             example: 'Chiropractic, PT, naturopathy, IV bar' },
]

const DEFAULT_SAMPLE = (
  'Hi {{first_name}}, reminder of your appointment at {{clinic_name}} tomorrow at {{time}}. ' +
  'Reply Y to confirm, R to reschedule, or STOP to opt out.'
)

export function BrandRegistrationForm({
  e164,
  initial,
  onSubmit,
  onBack,
}: BrandRegistrationFormProps) {
  // Initial values: prefer previously-submitted brand data on the org
  // row (resume case) over empty strings. EIN comes back digits-only;
  // we render it formatted XX-XXXXXXX.
  const init = (initial ?? {}) as Partial<BrandData>
  const initialEin = typeof init.ein === 'string' && init.ein.length === 9
    ? `${init.ein.slice(0, 2)}-${init.ein.slice(2)}`
    : (init.ein as string | undefined) ?? ''

  const [businessName,  setBusinessName]  = useState(init.business_name ?? '')
  const [dba,           setDba]           = useState(init.dba ?? '')
  const [ein,           setEin]           = useState(initialEin)
  const [einFocused,    setEinFocused]    = useState(false)
  const [addressLine1,  setAddressLine1]  = useState(init.address_line1 ?? '')
  const [addressLine2,  setAddressLine2]  = useState(init.address_line2 ?? '')
  const [city,          setCity]          = useState(init.city ?? '')
  const [region,        setRegion]        = useState(init.region ?? '')
  const [postalCode,    setPostalCode]    = useState(init.postal_code ?? '')
  const [websiteUrl,    setWebsiteUrl]    = useState(init.website_url ?? '')
  const [businessEmail, setBusinessEmail] = useState(init.business_email ?? '')
  const [businessPhone, setBusinessPhone] = useState(init.business_phone ?? '')
  const [vertical,      setVertical]      = useState<BrandData['vertical']>(init.vertical ?? 'aesthetic')
  const [sampleMessage, setSampleMessage] = useState(init.sample_message ?? DEFAULT_SAMPLE)
  const [submitting,    setSubmitting]    = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  // Display rendering of EIN when not focused: show only the last 4.
  // When focused, show the full value so the typist can verify.
  const displayedEin = einFocused
    ? ein
    : ein.length >= 4
      ? '••-•••' + ein.replace(/-/g, '').slice(-4)
      : ein

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Light client-side validation. Server re-validates with zod so
    // these don't need to be exhaustive — just enough to catch typos
    // before round-tripping to Twilio.
    if (!/^\d{2}-?\d{7}$/.test(ein)) {
      setError('EIN must be 9 digits (XX-XXXXXXX).')
      return
    }
    if (!/^\+[1-9]\d{6,14}$/.test(businessPhone)) {
      setError('Business phone must be in E.164 format (e.g. +14155551234).')
      return
    }

    setSubmitting(true)
    const r = await onSubmit({
      business_name:   businessName.trim(),
      dba:             dba.trim() || null,
      ein,
      address_line1:   addressLine1.trim(),
      address_line2:   addressLine2.trim() || null,
      city:            city.trim(),
      region:          region.trim(),
      postal_code:     postalCode.trim(),
      country_code:    'US',                       // TrustHub policy is US-only at this stage
      website_url:     websiteUrl.trim(),
      business_email:  businessEmail.trim(),
      business_phone:  businessPhone.trim(),
      vertical,
      sample_message:  sampleMessage.trim(),
    })
    setSubmitting(false)

    if (!r.ok) {
      setError(r.error ?? 'Could not start provisioning')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg bg-brand-50 border border-brand-100 px-4 py-3">
        <p className="text-sm text-gray-700">
          You're registering{' '}
          <span className="font-mono font-medium text-gray-900">{e164}</span> for
          US carrier-approved SMS. This identity is reviewed by Twilio + the
          carriers; please use your real legal business info.
        </p>
      </div>

      {/* ── Identity ─────────────────────────────────────── */}
      <Section title="Business identity">
        <Field label="Legal business name" required>
          <Input
            value={businessName}
            onChange={e => setBusinessName(e.target.value)}
            maxLength={200}
            required
          />
        </Field>
        <Field label="DBA / Trade name" hint="Optional. Leave blank if same as legal name.">
          <Input
            value={dba ?? ''}
            onChange={e => setDba(e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field
          label="EIN / Federal Tax ID"
          hint="9 digits. Masked while not focused for privacy."
          required
        >
          <Input
            value={displayedEin}
            onFocus={() => setEinFocused(true)}
            onBlur={() => setEinFocused(false)}
            onChange={e => {
              if (!einFocused) return                       // discard edits while masked
              setEin(e.target.value.replace(/[^\d-]/g, '').slice(0, 10))
            }}
            inputMode="numeric"
            autoComplete="off"
            placeholder="12-3456789"
            required
          />
        </Field>
      </Section>

      {/* ── Address ──────────────────────────────────────── */}
      <Section title="Business address">
        <Field label="Address line 1" required>
          <Input value={addressLine1} onChange={e => setAddressLine1(e.target.value)} required />
        </Field>
        <Field label="Address line 2">
          <Input value={addressLine2 ?? ''} onChange={e => setAddressLine2(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="City" required>
            <Input value={city} onChange={e => setCity(e.target.value)} required />
          </Field>
          <Field label="State / Region" required>
            <Input value={region} onChange={e => setRegion(e.target.value)} required />
          </Field>
          <Field label="ZIP / Postal" required>
            <Input value={postalCode} onChange={e => setPostalCode(e.target.value)} required />
          </Field>
        </div>
      </Section>

      {/* ── Contact ──────────────────────────────────────── */}
      <Section title="Contact + web">
        <Field label="Business website URL" required>
          <Input
            type="url"
            value={websiteUrl}
            onChange={e => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
            required
          />
        </Field>
        <Field label="Business email" required>
          <Input
            type="email"
            value={businessEmail}
            onChange={e => setBusinessEmail(e.target.value)}
            required
          />
        </Field>
        <Field
          label="Business phone (E.164)"
          hint="Reachable owner/admin line. NOT the new number you just selected."
          required
        >
          <Input
            value={businessPhone}
            onChange={e => setBusinessPhone(e.target.value)}
            placeholder="+14155551234"
            required
          />
        </Field>
      </Section>

      {/* ── Campaign ─────────────────────────────────────── */}
      <Section title="Messaging campaign">
        <Field label="Clinic vertical" required>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {VERTICAL_OPTIONS.map(opt => (
              <label
                key={opt.value}
                className={
                  'cursor-pointer rounded-lg border p-3 text-sm transition-colors ' +
                  (vertical === opt.value
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-gray-200 hover:border-gray-300')
                }
              >
                <input
                  type="radio"
                  className="sr-only"
                  name="vertical"
                  value={opt.value}
                  checked={vertical === opt.value}
                  onChange={() => setVertical(opt.value)}
                />
                <div className="font-medium text-gray-900">{opt.label}</div>
                <div className="mt-0.5 text-xs text-gray-500">{opt.example}</div>
              </label>
            ))}
          </div>
        </Field>
        <Field
          label="Sample SMS message"
          hint="The carriers review this verbatim. Must end with 'Reply STOP to opt out.' Default below is pre-approved."
          required
        >
          <textarea
            value={sampleMessage}
            onChange={e => setSampleMessage(e.target.value)}
            rows={4}
            maxLength={1024}
            className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            required
          />
        </Field>
      </Section>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:justify-between pt-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          ← Back to number search
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Starting provisioning…' : 'Buy & register'}
        </Button>
      </div>
    </form>
  )
}

// ── Local layout primitives ─────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label:     string
  hint?:     string
  required?: boolean
  children:  React.ReactNode
}) {
  return (
    <div>
      <Label className="mb-1.5 block">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
