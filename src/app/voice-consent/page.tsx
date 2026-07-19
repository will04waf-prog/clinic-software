import type { Metadata } from 'next'
import Link from 'next/link'
import { LogoMark } from '@/components/ui/logo-mark'

/**
 * Phase 5 W1 — /voice-consent.
 *
 * Public-facing page describing how voice calls placed to businesses
 * on the Tarhunna platform may be answered by an AI receptionist,
 * recorded, and transcribed. The voice analog of /sms-consent.
 *
 * The agent's spoken opener handles real-time recording consent on
 * every call (two-party-state coverage). This page is the static
 * fallback a business can link to in their own intake materials
 * and the privacy policy.
 */

export const metadata: Metadata = {
  title: 'Voice Calls & Recording Consent',
  description: 'How voice calls, AI receptionist answering, and recording work on the Tarhunna platform.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://tarhunna.net/voice-consent' },
}

export default function VoiceConsentPage() {
  return (
    <div className="min-h-screen bg-[#F5EFE1] flex flex-col">
      <header className="border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark size="sm" standalone />
          </Link>
          <div className="flex items-center gap-5">
            <Link href="/" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">Home</Link>
            <Link href="/login" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">Sign in</Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-16 space-y-6 text-gray-700 text-sm leading-7">
          <h1 className="text-3xl font-bold text-gray-900">Voice Calls & Recording Consent</h1>

          <p>
            Some businesses that use Tarhunna — service companies such as landscapers, as well as clinics — route their inbound phone line to an AI receptionist. When you call such a business, the AI answers, helps you with appointments, estimates, or general questions, and may record the call for quality and record-keeping.
          </p>

          <h2 className="text-lg font-semibold text-gray-900 pt-4">What to expect</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>The AI introduces itself at the start of every call ("you're speaking with an AI assistant").</li>
            <li>The AI tells you the call may be recorded. You can say "no recording" and the call will continue without being recorded.</li>
            <li>The AI can answer general questions (hours, services, location), book appointments, take messages, request estimates, and transfer you to a human team member.</li>
            <li>If you raise an emergency or a question the AI cannot answer, it will transfer you to the business's team or take a message.</li>
            <li>You can ask to speak to a person at any time by saying "transfer me to a human" or "speak to staff".</li>
          </ul>

          <h2 className="text-lg font-semibold text-gray-900 pt-4">How recordings and transcripts are used</h2>
          <p>
            Recordings and AI-generated transcripts are stored by the business as part of your customer record. They are subject to the same protections the business uses for any other customer information (including HIPAA where the business is a covered healthcare entity, plus its own privacy practices). Recordings and transcripts are not shared with third parties for marketing.
          </p>

          <h2 className="text-lg font-semibold text-gray-900 pt-4">Refusing to be recorded</h2>
          <p>
            You can refuse to be recorded by saying "no recording" when the AI prompts you. The call continues. The business will still receive a brief summary of what was discussed (without audio), but no recording or full transcript will be stored.
          </p>

          <h2 className="text-lg font-semibold text-gray-900 pt-4">Two-party consent states</h2>
          <p>
            In jurisdictions that require all parties to consent before a call may be recorded (including California, Florida, Illinois, Massachusetts, Maryland, Montana, Nevada, New Hampshire, Pennsylvania, and Washington), recordings are only stored when you explicitly consent during the AI's opener.
          </p>

          <h2 className="text-lg font-semibold text-gray-900 pt-4">Your data rights</h2>
          <p>
            Contact the business directly to request access to, correction of, or deletion of recordings and transcripts of your calls. The business — not Tarhunna — is the data controller for your customer record.
          </p>

          <p className="pt-6 text-xs text-gray-500">
            Last updated: 2026. Questions? <Link href="/privacy" className="text-brand-600 hover:underline">See our privacy policy</Link>.
          </p>
        </div>
      </main>
    </div>
  )
}
