/**
 * Phase 5 M3 — dashboard banner for owners who haven't completed phone
 * number provisioning yet.
 *
 * Why a stand-alone component instead of an inline JSX block:
 *   - The /app/(dashboard)/dashboard/page.tsx file is owned by other
 *     milestones; this banner is emitted as a drop-in so the
 *     integration sweep can wire it in without re-deriving the
 *     visibility predicate.
 *   - The visibility predicate ("show if owner AND no vapi_phone_number_id")
 *     is captured in the `shouldShow` prop signature below — callers
 *     compute it once in the dashboard's server component and pass it
 *     in; this component is purely presentational.
 *
 * Visibility rules (caller computes, banner displays):
 *   - Only render if the caller is the owner of the org. Staff/admin
 *     can't act on this prompt anyway (provisioning is owner-only),
 *     so showing it to them is noise.
 *   - Only render if organizations.vapi_phone_number_id IS NULL. The
 *     onboarding page is the same gate — they should agree.
 *
 * The CTA always deep-links to /onboarding/phone-number which is
 * itself idempotent: if the predicate ever falsely renders the banner
 * after the number is provisioned, the page redirects to /dashboard
 * on its own.
 */

import Link from 'next/link'

interface PhoneNumberBannerProps {
  shouldShow: boolean
}

export function PhoneNumberBanner({ shouldShow }: PhoneNumberBannerProps) {
  if (!shouldShow) return null

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">
            Set up your clinic phone number
          </h3>
          <p className="text-xs text-amber-800 mt-0.5">
            Reminders, AI receptionist, and patient texts all flow through your
            number. Most clinics finish setup in under 5 minutes.
          </p>
        </div>
        <Link
          href="/onboarding/phone-number"
          className="inline-flex items-center justify-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 whitespace-nowrap"
        >
          Set it up →
        </Link>
      </div>
    </div>
  )
}
