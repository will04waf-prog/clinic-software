import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/ui/logo'

export const metadata: Metadata = {
  title: 'Terms of Service — Tarhunna',
  description: 'Terms of Service for Tarhunna CRM software.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://tarhunna.net/terms' },
}

const EFFECTIVE_DATE = 'April 18, 2026'
const CONTACT_EMAIL  = 'hello@tarhunna.net'

export default function TermsPage() {
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

          <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
          <p className="text-sm text-gray-400 mb-10">Effective date: {EFFECTIVE_DATE}</p>

          <div className="prose prose-gray max-w-none space-y-10 text-gray-700 leading-relaxed">

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">1. Agreement to Terms</h2>
              <p>
                By creating an account or using Tarhunna, you agree to these Terms of Service.
                If you do not agree, do not use the service.
              </p>
              <p className="mt-3">
                Tarhunna is a service operating as a sole proprietorship in Frederick, Maryland.
                References to &ldquo;Tarhunna,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
                &ldquo;our&rdquo; mean the operators of the service. &ldquo;You&rdquo; means the
                clinic, business, or individual accessing the service.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">2. Description of Service</h2>
              <p>
                Tarhunna is a CRM platform designed for aesthetic clinics, med spas, and plastic
                surgery practices. The software provides tools for lead capture, contact management,
                consultation scheduling, pipeline tracking, automated follow-up, and appointment
                reminders via email and SMS.
              </p>
              <p className="mt-3">
                We reserve the right to modify, add, or remove features at any time. We will make
                reasonable efforts to communicate significant changes that affect existing
                functionality.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">3. Account Registration</h2>
              <p>
                To use Tarhunna, you must create an account with a valid email address. You are
                responsible for:
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li>Keeping your login credentials secure and confidential</li>
                <li>All activity that occurs under your account</li>
                <li>Notifying us promptly if you suspect unauthorized access</li>
                <li>Ensuring that information you provide during registration is accurate</li>
              </ul>
              <p className="mt-4">
                You may not share your account credentials with individuals outside your
                organization or create accounts on behalf of others without authorization.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">4. Acceptable Use</h2>
              <p>You agree to use Tarhunna only for lawful purposes. You may not:</p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li>Use the service to send unsolicited commercial messages (spam)</li>
                <li>Send SMS or email communications to individuals who have not consented</li>
                <li>Store or transmit data you do not have the legal right to use</li>
                <li>Attempt to gain unauthorized access to Tarhunna systems or other users&apos; data</li>
                <li>Use the platform to facilitate any illegal activity</li>
                <li>Reverse engineer, copy, or redistribute any part of the software</li>
                <li>Overload or disrupt the service through automated requests or abuse</li>
              </ul>
              <p className="mt-4">
                Violations of this section may result in immediate account suspension or termination.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">5. Your Data and Patient Information</h2>
              <p>
                You retain ownership of the data you enter into Tarhunna, including patient and
                contact records. You are solely responsible for:
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li>Ensuring you have appropriate consent to collect and store patient information</li>
                <li>Complying with applicable privacy laws including HIPAA where relevant to your practice</li>
                <li>Obtaining patient consent before sending SMS appointment reminders</li>
                <li>The accuracy and legality of the data you enter</li>
              </ul>
              <p className="mt-4">
                Tarhunna is a software tool. We do not independently verify the data you enter,
                and we are not liable for your compliance with applicable healthcare or privacy
                regulations. You are responsible for your own regulatory compliance.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">6. Billing and Subscriptions</h2>
              <p>
                Tarhunna offers paid subscription plans. By subscribing, you authorize us to charge
                the payment method you provide on a recurring basis per your selected billing cycle.
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-2">
                <li>Subscription fees are billed in advance</li>
                <li>All charges are processed through Stripe and are non-refundable except where required by law</li>
                <li>You may cancel your subscription at any time through the billing settings in your account</li>
                <li>Cancellation takes effect at the end of the current billing period; you retain access until then</li>
                <li>We reserve the right to change pricing with reasonable advance notice</li>
              </ul>
              <p className="mt-4">
                New accounts may be offered a free trial period. At the end of the trial, access
                will require a paid subscription.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">7. No Warranties</h2>
              <p>
                Tarhunna is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
                warranties of any kind, express or implied. We do not warrant that the service will
                be uninterrupted, error-free, or free of security vulnerabilities. We do not
                guarantee that the service will meet your specific business requirements.
              </p>
              <p className="mt-3">
                We are not responsible for any loss of data, missed appointments, failed
                communications, or business losses arising from use of or inability to use the
                service.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">8. Limitation of Liability</h2>
              <p>
                To the fullest extent permitted by law, Tarhunna and its operator shall not be
                liable for any indirect, incidental, special, consequential, or punitive damages,
                including but not limited to loss of profits, loss of data, or business interruption,
                arising out of your use of or inability to use the service.
              </p>
              <p className="mt-3">
                In no event will our total liability to you exceed the amount you paid to Tarhunna
                in the three months preceding the claim.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">9. Termination</h2>
              <p>
                You may cancel your account at any time. We reserve the right to suspend or
                terminate your account at any time if you violate these Terms or engage in
                conduct we determine to be harmful to other users, the platform, or third parties.
              </p>
              <p className="mt-3">
                Upon termination, your access to the service will end. You may request a copy of
                your data before termination by contacting us at{' '}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 hover:underline">{CONTACT_EMAIL}</a>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">10. Changes to Terms</h2>
              <p>
                We may update these Terms from time to time. When we do, we will update the
                effective date at the top of this page. Continued use of Tarhunna after changes
                are posted constitutes your acceptance of the updated Terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">11. Governing Law</h2>
              <p>
                These Terms are governed by the laws of the State of Maryland, without regard to
                its conflict of law provisions. Any disputes arising from these Terms or your use
                of Tarhunna shall be subject to the jurisdiction of the courts located in Maryland.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">12. Contact</h2>
              <p>
                Questions about these Terms? Contact us at{' '}
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
            <Link href="/pricing" className="hover:text-gray-700 transition-colors">Pricing</Link>
            <Link href="/privacy" className="hover:text-gray-700 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-700 transition-colors">Terms</Link>
            <Link href="/login" className="hover:text-gray-700 transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>

    </div>
  )
}
