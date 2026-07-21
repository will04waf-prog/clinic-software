'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LogoMark } from '@/components/ui/logo-mark'
import { dict, DEFAULT_LOCALE, type Locale } from '@/lib/i18n'
import { Leaf, Brush, HardHat, UtensilsCrossed, Check } from 'lucide-react'

type Step = 'industry' | 'account'

// Map an API error code (or client-side code) to a localized message.
function errorFor(code: string, t: ReturnType<typeof dict>['signup']): string {
  switch (code) {
    case 'business_name': return t.errBusinessName
    case 'owner_name':    return t.errOwnerName
    case 'email':         return t.errEmail
    case 'password':      return t.errPassword
    case 'phone':         return t.errPhone
    case 'phone_format':  return t.errPhoneFormat
    case 'email_taken':   return t.errEmailTaken
    default:              return t.errGeneric
  }
}

export default function SignupPage() {
  const router = useRouter()
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE)
  const [step, setStep] = useState<Step>('industry')
  // Per-vertical funnels: /limpieza and /construccion link here with
  // ?v=. Read after mount (client-only) so SSR never touches window.
  // Construction rides the 'trades' vertical (Layla urgent detection
  // included) — it is a marketing funnel, not a new backend key.
  const [vertical, setVertical] = useState<'landscaping' | 'cleaning' | 'trades'>('landscaping')
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('v')
    if (v === 'limpieza') setVertical('cleaning')
    if (v === 'construccion') setVertical('trades')
  }, [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    business_name: '',
    full_name: '',
    email: '',
    owner_cell: '',
    password: '',
  })

  const m = dict(locale)
  const t = m.signup
  const focusRing = 'focus-visible:ring-[#028090] focus-visible:border-[#028090]'

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, vertical, owner_language: locale }),
      })
      const ctype = res.headers.get('content-type') ?? ''
      if (!ctype.includes('application/json')) throw new Error('server')
      const data = await res.json()
      if (!res.ok) {
        setError(errorFor(data.code ?? '', t))
        return
      }
      const supabase = createClient()
      await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
      router.push('/onboarding')
      router.refresh()
    } catch {
      setError(t.errGeneric)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center bg-[#F5EFE1] px-4 py-8 sm:py-12">
      {/* Language toggle */}
      <div className="w-full max-w-sm flex justify-end">
        <button
          type="button"
          onClick={() => setLocale((l) => (l === 'es' ? 'en' : 'es'))}
          className="text-xs font-semibold text-[#028090] rounded-full border border-[#028090]/30 px-3 py-1 hover:bg-[#028090]/10 transition-colors"
        >
          {m.common.switchToEn}
        </button>
      </div>

      <div className="mb-6 mt-2 flex flex-col items-center gap-2">
        <LogoMark size="xl" standalone />
      </div>

      <div className="w-full max-w-sm">
        {step === 'industry' ? (
          <div>
            <h1 className="text-xl font-bold text-gray-900 text-balance">{t.pickIndustryTitle}</h1>
            <p className="mt-1 text-sm text-gray-500">{t.pickIndustrySubtitle}</p>

            <div className="mt-5 space-y-2.5">
              {/* Active industries — the tap picks the org's vertical. */}
              {([
                { v: 'landscaping' as const, icon: Leaf, label: t.industryLandscaping, desc: t.industryLandscapingDesc },
                { v: 'cleaning' as const, icon: Brush, label: t.industryCleaning, desc: t.industryCleaningDesc },
                { v: 'trades' as const, icon: HardHat, label: t.industryConstruction, desc: t.industryConstructionDesc },
              ]).map(({ v, icon: Icon, label, desc }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setVertical(v); setError(null); setStep('account') }}
                  className={`w-full flex items-center gap-3 rounded-2xl border-2 bg-white px-4 py-4 text-left shadow-sm active:scale-[.99] transition-transform ${vertical === v ? 'border-[#028090]' : 'border-gray-200'}`}
                >
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#02C39A]/15">
                    <Icon className="h-5 w-5 text-[#028090]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-gray-900">{label}</span>
                    <span className="block text-xs text-gray-500 leading-snug">{desc}</span>
                  </span>
                  {vertical === v && <Check className="h-5 w-5 shrink-0 text-[#028090]" />}
                </button>
              ))}

              {/* Coming soon */}
              {[
                { icon: UtensilsCrossed, label: t.industryRestaurants },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  aria-disabled="true"
                  className="w-full flex items-center gap-3 rounded-2xl border border-gray-200 bg-white/50 px-4 py-4 text-left opacity-60 cursor-not-allowed"
                >
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100">
                    <Icon className="h-5 w-5 text-gray-400" />
                  </span>
                  <span className="min-w-0 flex-1 font-medium text-gray-500">{label}</span>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {t.soonBadge}
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-5 text-center text-sm text-gray-500">
              {t.haveAccount}{' '}
              <Link href="/login" className="text-[#028090] hover:underline font-medium">{t.logIn}</Link>
            </p>
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => { setError(null); setStep('industry') }}
              className="mb-3 text-sm text-gray-500 hover:text-gray-700"
            >
              ← {m.common.back}
            </button>
            <h1 className="text-xl font-bold text-gray-900 text-balance">{t.createAccountTitle}</h1>
            <p className="mt-1 text-sm text-gray-500">{t.createAccountSubtitle}</p>

            <form onSubmit={handleSignup} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="business_name">{t.businessNameLabel}</Label>
                <Input id="business_name" value={form.business_name} onChange={(e) => update('business_name', e.target.value)} placeholder={t.businessNamePlaceholder} required className={focusRing} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="full_name">{t.ownerNameLabel}</Label>
                <Input id="full_name" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} placeholder={t.ownerNamePlaceholder} required className={focusRing} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="owner_cell">{t.phoneLabel}</Label>
                <Input id="owner_cell" type="tel" inputMode="tel" value={form.owner_cell} onChange={(e) => update('owner_cell', e.target.value)} placeholder={t.phonePlaceholder} required className={focusRing} />
                <p className="text-xs text-gray-400">{t.phoneHint}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">{t.emailLabel}</Label>
                <Input id="email" type="email" inputMode="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder={t.emailPlaceholder} required className={focusRing} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t.passwordLabel}</Label>
                <Input id="password" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder={t.passwordHint} minLength={8} required className={focusRing} />
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <Button type="submit" className="w-full bg-gradient-brand text-white hover:opacity-95 transition-all" disabled={loading}>
                {loading ? m.common.saving : t.submitCta}
              </Button>
              <p className="text-center text-xs text-gray-400">{t.trialNote(14)}</p>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
