'use client'

import { useRouter } from 'next/navigation'
import { LogoMark } from '@/components/ui/logo-mark'
import { dict, type Locale } from '@/lib/i18n'
import { UserPlus, FileText, MessageCircle, CreditCard, ArrowRight } from 'lucide-react'

// CRM-pivot onboarding: teaches the v1 loop on the owner's phone. Four
// steps, Spanish-first. The primary CTA drops the owner straight into the
// first thing they should do — add a client.
export function LoopOnboarding({ locale, ownerName }: { locale: Locale; ownerName: string }) {
  const router = useRouter()
  const t = dict(locale).onboarding

  const steps = [
    { icon: UserPlus, title: t.step1, desc: t.step1Desc },
    { icon: FileText, title: t.step2, desc: t.step2Desc },
    { icon: MessageCircle, title: t.step3, desc: t.step3Desc },
    { icon: CreditCard, title: t.step4, desc: t.step4Desc },
  ]

  return (
    <div className="min-h-screen bg-[#F5EFE1] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <LogoMark size="lg" standalone />
          <h1 className="text-2xl font-bold text-gray-900 text-balance">{t.welcomeTitle(ownerName)}</h1>
          <p className="text-sm text-gray-500 max-w-xs">{t.welcomeSubtitle}</p>
        </div>

        <ol className="space-y-2.5">
          {steps.map(({ icon: Icon, title, desc }, i) => (
            <li key={title} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
              <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#02C39A]/15">
                <Icon className="h-5 w-5 text-[#028090]" />
                <span className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#028090] text-[11px] font-bold text-white">
                  {i + 1}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-gray-900">{title}</span>
                <span className="block text-xs text-gray-500 leading-snug">{desc}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand px-5 py-3.5 text-base font-semibold text-white active:scale-[.99] transition-transform shadow-sm"
          >
            {t.startCta}
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            {t.skipCta}
          </button>
        </div>
      </div>
    </div>
  )
}
