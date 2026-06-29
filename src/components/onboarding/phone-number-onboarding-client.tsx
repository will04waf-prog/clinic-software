/**
 * Phase 5 M3 — top-level client wizard that orchestrates the three
 * sub-steps of phone-number onboarding:
 *
 *   1. Search    → NumberSearchForm
 *   2. Register  → BrandRegistrationForm (gathers A2P brand data)
 *   3. Progress  → ProvisioningProgress (polls the M5 queue)
 *
 * Why a coordinator component instead of three sibling routes:
 *   - The selected E.164 + brand data live entirely in memory; pushing
 *     them through the URL would mean either query-string round-trips
 *     (PII in the query) or session storage (a separate persistence
 *     concern). Keeping the wizard state in this one client component
 *     is simpler and the only "resumable" case is "I closed the tab
 *     mid-progress", which we handle by reading a2p_brand_data from
 *     the org row on the server-rendered page.
 *   - Steps 1 + 2 are zero-cost back/forth UI. Step 3 is the point of
 *     no return: once the M2 provision route is called, the chain is
 *     enqueued and can't be cancelled from the UI.
 */

'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogoMark } from '@/components/ui/logo-mark'
import { BrandRegistrationForm, type BrandData } from '@/components/onboarding/brand-registration-form'
import { NumberSearchForm } from '@/components/onboarding/number-search-form'
import { ProvisioningProgress } from '@/components/onboarding/provisioning-progress'
import { provisionNumberAction } from '@/app/onboarding/phone-number/actions'

interface PhoneNumberOnboardingClientProps {
  orgName:           string
  orgId:             string
  existingBrandData: Record<string, unknown> | null
  a2pStatus:         string
}

type Step = 'search' | 'register' | 'progress'

export function PhoneNumberOnboardingClient({
  orgName,
  existingBrandData,
  a2pStatus,
}: PhoneNumberOnboardingClientProps) {
  const router = useRouter()
  // If the org has previously-saved brand data AND the a2p_status is
  // still pending or rejected, jump the owner straight to the progress
  // view — they're mid-flow, not starting fresh. If a2p_status is
  // 'not_started' (no prior attempt) we start at search regardless.
  const initialStep: Step =
    existingBrandData && (a2pStatus === 'pending' || a2pStatus === 'rejected')
      ? 'progress'
      : 'search'

  const [step, setStep]    = useState<Step>(initialStep)
  const [e164, setE164]    = useState<string | null>(null)

  function handleSelectNumber(picked: string) {
    setE164(picked)
    setStep('register')
  }

  async function handleSubmitBrand(data: BrandData): Promise<{ ok: boolean; error?: string }> {
    if (!e164) return { ok: false, error: 'No number selected; go back to search.' }
    const r = await provisionNumberAction({ e164, brandData: data })
    if (!r.ok) return { ok: false, error: r.error }
    setStep('progress')
    return { ok: true }
  }

  function handleDone() {
    // Land on the call-agent settings card — that's the post-onboarding
    // hub where the owner finishes BAA attestation, sets greeting,
    // tunes business hours, etc.
    router.push('/settings/call-agent')
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <LogoMark size="xl" standalone />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {step === 'search' && 'Pick your clinic phone number'}
            {step === 'register' && 'Register your business for SMS'}
            {step === 'progress' && 'Setting up your number'}
          </h1>
          <p className="mt-2 text-gray-500 max-w-md mx-auto">
            {step === 'search' && (
              <>This is the number patients will call and text {orgName}. Pick an area code your patients will recognize.</>
            )}
            {step === 'register' && (
              <>US carriers require business identity verification before they'll deliver reminders or intake texts.</>
            )}
            {step === 'progress' && (
              <>We're wiring up Twilio + Vapi + carrier registration. You can leave this page — provisioning continues in the background.</>
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 shadow-sm">
          {step === 'search' && (
            <NumberSearchForm onSelect={handleSelectNumber} />
          )}
          {step === 'register' && e164 && (
            <BrandRegistrationForm
              e164={e164}
              initial={existingBrandData}
              onSubmit={handleSubmitBrand}
              onBack={() => setStep('search')}
            />
          )}
          {step === 'progress' && (
            <ProvisioningProgress onDone={handleDone} />
          )}
        </div>

        <StepIndicator current={step} />
      </div>
    </div>
  )
}

// ── 3-dot indicator at the bottom of the wizard ─────────────────
function StepIndicator({ current }: { current: Step }) {
  const order: Step[] = ['search', 'register', 'progress']
  const idx = order.indexOf(current)
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      {order.map((s, i) => (
        <span
          key={s}
          className={
            'h-1.5 rounded-full transition-all ' +
            (i === idx
              ? 'bg-brand-500 w-8'
              : i < idx
              ? 'bg-emerald-500 w-4'
              : 'bg-gray-200 w-4')
          }
        />
      ))}
    </div>
  )
}
