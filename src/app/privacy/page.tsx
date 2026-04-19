import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/ui/logo'

export const metadata: Metadata = {
  title: 'Privacy Policy — Tarhunna',
  description: 'Privacy Policy for Tarhunna CRM software.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://tarhunna.net/privacy' },
}

const EFFECTIVE_DATE = 'April 18, 2026'
const CONTACT_EMAIL  = 'hello@tarhunna.net'

export default function PrivacyPage() {
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

          <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-400 mb-10">Effective date: {EFFECTIVE_DATE}</p>

          <div className="prose prose-gray max-w-none space-y-10 text-gray-700 leading-relaxed">

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">1. Who We Are</h2>
              <p>
                Tarhunna, operated by Cesar Adolfo Menjivar Molina, provides CRM software designed for
                aesthetic clinics, med spas, and plastic surgery practices. Our platform helps clinics
                capture leads, manage contacts, book consultations, and send appointment reminders.
              </p>
              <p className="mt-3">
                When we say &ldquo;Tarhunna,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
                &ldquo;our&rdquo; in this policy, we mean Tarhunna and its operator.
                &ldquo;You&rdquo; refers to clinic owners and staff who use Tarhunna.
                &ldquo;Patients&rdquo; or &ldquo;contacts&rdquo; refers to the individuals whose
                information clinic users manage within the platform.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">2. Information We Collect</h2>

              <h3 className="font-medium text-gray-900 mb-2">Account information</h3>
              <p>
                When you create a Tarhunna account, we collect your name, email address, and a
                hashed password. We also collect information about your clinic, including clinic
                name and time zone.
              </p>

              <h3 className="font-medium text-gray-900 mt-5 mb-2">Clinic contact data</h3>
              <p>
                As a clinic user, you enter and store contact information for your patients and
                leads inside Tarhunna. This may include names, email addresses, phone numbers,
                notes, and treatment interests. You are responsible for ensuring you have the
                appropriate rights to store and use this information.
              </p>

              <h3 className="font-medium text-gray-900 mt-5 mb-2">SMS consent</h3>
              <p>
                When a patient submits a consultation request through your clinic&apos;s intake
                form, they may check a box consenting to receive appointment reminders by SMS.
                We store this consent status and use it to determine whether SMS messages may be sent.
              </p>

              <h3 className="font-medium text-gray-900 mt-5 mb-2">Usage and technical data</h3>
              <p>
                We collect basic usage data such as pages visited and features used in order to
                operate and improve the service. We use session cookies for authentication. We do
                not currently use third-party advertising or tracking cookies.
              </p>

              <h3 className="font-medium text-gray-900 mt-5 mb-2">Billing information</h3>
              <p>
                Payments are handled by Stripe. We do not store your full credit card number.
                Stripe provides us with limited billing details such as your card type, last four
                digits, and billing status.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">3. How We Use Information</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>To create and manage your account and provide access to the software</li>
                <li>To operate clinic workflows including contact management, pipeline tracking, and consultation scheduling</li>
                <li>To send transactional emails such as consultation confirmations and appointment reminders when enabled</li>
                <li>To send appointment reminder SMS messages to patients who have provided explicit consent</li>
                <li>To process subscription payments through Stripe</li>
                <li>To maintain system logs and troubleshoot issues</li>
                <li>To improve and develop the platform</li>
              </ul>
              <p className="mt-4">
                We do not use your data or your patients&apos; data for advertising purposes.
                We do not sell data to third parties.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">4. SMS Communications</h2>
              <p>
                Tarhunna can send appointment reminder SMS messages to patients on behalf of
                clinics using our platform. The following applies to all SMS communication:
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li>SMS messages are only sent to patients who have explicitly checked the SMS consent checkbox on the clinic&apos;s intake form</li>
                <li>Messages are transactional in nature — appointment confirmations and reminders only, not marketing</li>
                <li>Every message includes the clinic name and opt-out instructions</li>
                <li>Patients can reply STOP at any time to opt out of further SMS messages</li>
                <li>Message and data rates from the patient&apos;s carrier may apply</li>
              </ul>
              <p className="mt-4">
                Clinics are responsible for ensuring that SMS consent is collected appropriately
                and in accordance with applicable laws, including the Telephone Consumer
                Protection Act (TCPA).
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">5. Data Sharing and Service Providers</h2>
              <p>
                We share data only with third-party service providers necessary to operate the
                platform. These providers are:
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li><strong>Supabase</strong> — cloud database and authentication infrastructure</li>
                <li><strong>Twilio</strong> — SMS delivery for appointment reminders</li>
                <li><strong>Resend</strong> — transactional email delivery</li>
                <li><strong>Stripe</strong> — subscription billing and payment processing</li>
                <li><strong>Vercel</strong> — application hosting and infrastructure</li>
              </ul>
              <p className="mt-4">
                Each provider is bound by their own privacy policy and data processing agreements.
                We do not share your data with any other parties except as required by law.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">6. Data Retention</h2>
              <p>
                We retain account and clinic data for as long as your account is active or as
                needed to provide the service. If you cancel your account, you may request
                deletion of your data by contacting us at{' '}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 hover:underline">{CONTACT_EMAIL}</a>.
                We will process deletion requests within a reasonable timeframe.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">7. Security</h2>
              <p>
                We use industry-standard measures to protect your data, including encrypted
                connections (HTTPS), hashed passwords, and row-level security controls in our
                database. Access to data is scoped to your clinic — staff at one clinic cannot
                access data from another.
              </p>
              <p className="mt-3">
                No system is completely secure. We cannot guarantee absolute security and are
                not liable for unauthorized access beyond our reasonable control.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">8. Your Rights</h2>
              <p>
                You may request access to, correction of, or deletion of your personal data at
                any time by contacting us. If you are a patient whose information was entered into
                Tarhunna by a clinic, please contact that clinic directly — they control that data.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">9. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. If we make material changes,
                we will update the effective date at the top of this page. Continued use of
                Tarhunna after changes are posted constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">10. Contact</h2>
              <p>
                Questions about this Privacy Policy? Contact us at{' '}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 hover:underline">{CONTACT_EMAIL}</a>.
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
            <Link href="/privacy" className="hover:text-gray-700 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-700 transition-colors">Terms</Link>
            <Link href="/login" className="hover:text-gray-700 transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>

    </div>
  )
}
