import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Logo } from '@/components/ui/logo'

export const metadata: Metadata = {
  title: 'SMS Communications Consent',
  description: 'How SMS opt-in and consent works on the Tarhunna platform.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://tarhunna.net/sms-consent' },
}

const CONTACT_EMAIL = 'support@tarhunna.net'

export default function SmsConsentPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* Nav */}
      <header className="border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-5">
            <Link href="/pricing" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
              Pricing
            </Link>
            <Link href="/login" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-16">

          <h1 className="text-3xl font-bold text-gray-900 mb-8">SMS Communications Consent</h1>

          <div className="prose prose-gray max-w-none space-y-10 text-gray-700 leading-relaxed">

            <section>
              <p>
                Tarhunna provides a customer relationship management (CRM) platform used by
                aesthetic medical clinics in the United States to communicate with their patients
                and prospective patients. This page describes how SMS communications work through
                the Tarhunna platform and the consent process for receiving them.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">SMS consent is optional</h2>
              <p>
                SMS consent is <strong>not required</strong>{' '}to use any clinic&apos;s service.
                Patients can submit intake forms, schedule consultations, and receive treatment
                from clinics on the Tarhunna platform without ever consenting to SMS
                communications. Consent to receive SMS messages is not a condition of any
                purchase, service, or treatment.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">How patients opt in to receive SMS</h2>
              <p>
                When a patient submits an intake or appointment-request form on a clinic&apos;s
                website (powered by Tarhunna), they see a separate, optional checkbox for SMS
                consent. This checkbox is unchecked by default. The exact label reads:
              </p>
              <blockquote className="mt-4 border-l-4 border-gray-200 pl-4 italic text-gray-600">
                &ldquo;I agree to receive appointment reminders by SMS from [Clinic Name].
                Message and data rates may apply. Reply STOP at any time to opt out.&rdquo;
              </blockquote>
              <figure className="mt-6 rounded-lg border border-gray-200 bg-white overflow-hidden">
                <Image
                  src="/sms-consent-form-example.png"
                  alt="Tarhunna intake form showing the optional SMS consent checkbox unchecked, with full label text and Request Consultation submit button."
                  width={2930}
                  height={1594}
                  className="w-full h-auto"
                  priority={false}
                />
                <figcaption className="border-t border-gray-100 px-4 py-3 text-sm text-gray-500 italic leading-relaxed">
                  Example: Tarhunna&apos;s intake form as it appears to a patient on a clinic&apos;s website. The SMS consent checkbox appears at the bottom of the form, unchecked by default. Patients may submit the form with or without checking this box; submission is not contingent on consenting to SMS.
                </figcaption>
              </figure>
              <p className="mt-4">
                Patients may submit the form with or without checking this box. If unchecked, the
                clinic still receives the patient&apos;s information and may follow up by phone
                or email as the patient prefers &mdash; but no SMS will ever be sent to that
                number.
              </p>
              <p className="mt-4">
                A patient may also provide express written consent through:
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li>An in-clinic paper intake form with a separate SMS consent line</li>
                <li>A booking confirmation flow during an in-person or phone consultation request, where the staff member confirms verbally and records consent</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">What we send</h2>
              <p>
                If a patient has consented, Tarhunna sends the following types of SMS messages
                on behalf of clinics:
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li>Appointment reminders (typically 24 hours and 2 hours before a scheduled consultation)</li>
                <li>Appointment confirmations after booking</li>
                <li>Follow-up messages from the clinic to the patient</li>
              </ul>
              <p className="mt-4">
                All messages identify the originating clinic and include opt-out instructions.
                SMS messages are transactional in nature &mdash; appointment confirmations and
                reminders only &mdash; not marketing.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">How to opt out</h2>
              <p>
                Recipients may opt out of SMS communications at any time by replying STOP to any
                message. Recipients may reply HELP for help or contact their clinic directly.
                Opt-out is processed immediately, and no further SMS will be sent to that number
                from the clinic.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Contact</h2>
              <p>
                Questions about this policy or about SMS communications received:{' '}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 hover:underline">{CONTACT_EMAIL}</a>
              </p>
            </section>

          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6">
        <div className="max-w-4xl mx-auto flex flex-col items-center justify-between gap-3 sm:flex-row text-sm text-gray-400">
          <span>&copy; {new Date().getFullYear()} Tarhunna</span>
          <div className="flex items-center gap-5">
            <Link href="/" className="hover:text-gray-700 transition-colors">Home</Link>
            <Link href="/pricing" className="hover:text-gray-700 transition-colors">Pricing</Link>
            <Link href="/privacy" className="hover:text-gray-700 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-700 transition-colors">Terms</Link>
            <Link href="/sms-consent" className="hover:text-gray-700 transition-colors">SMS Consent</Link>
            <Link href="/login" className="hover:text-gray-700 transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>

    </div>
  )
}
