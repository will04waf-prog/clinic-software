import type { Metadata } from 'next'
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
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Sign in
          </Link>
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
              <h2 className="text-lg font-semibold text-gray-900 mb-3">How patients opt in to receive SMS</h2>
              <p>
                Patients and prospective patients provide consent to receive SMS messages by
                submitting one of the following:
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li>An online intake or appointment-request form on a clinic&apos;s website (powered by Tarhunna)</li>
                <li>An in-clinic paper intake form</li>
                <li>A booking confirmation flow during an in-person or phone consultation request</li>
              </ul>
              <p className="mt-4">
                In each case, the patient explicitly provides their phone number and agrees to
                receive SMS communications from the clinic regarding their consultation,
                appointment reminders, and related follow-up. Consent language presented to the
                patient at the time of submission reads:
              </p>
              <blockquote className="mt-4 border-l-4 border-gray-200 pl-4 italic text-gray-600">
                &ldquo;By providing your phone number, you agree to receive SMS messages from
                [Clinic Name] regarding your consultation, appointments, and related
                communications. Message and data rates may apply. Reply STOP to opt out at any
                time.&rdquo;
              </blockquote>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">What we send</h2>
              <p>
                Tarhunna sends the following types of SMS messages on behalf of clinics:
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li>Appointment reminders (typically 24 hours and 2 hours before a scheduled consultation)</li>
                <li>Appointment confirmations after booking</li>
                <li>Follow-up messages from the clinic to the patient</li>
              </ul>
              <p className="mt-4">
                All messages identify the originating clinic and include opt-out instructions.
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
