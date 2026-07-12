'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProcedurePicker } from '@/components/settings/procedure-picker'
import { Button } from '@/components/ui/button'
import { LogoMark } from '@/components/ui/logo-mark'

// Legacy med-spa onboarding — the service picker. Unchanged from the
// original /onboarding page; extracted so the route can branch by vertical.
export function MedspaOnboarding() {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch('/api/org/procedures', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ procedures: selected }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json()
      setError(j.error ?? 'Something went wrong')
      return
    }
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <LogoMark size="xl" standalone />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome to Tarhunna</h1>
          <p className="mt-2 text-gray-500 max-w-md mx-auto">
            Choose the services your clinic offers. These will appear on your patient intake form.
            You can always change them later in Settings.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 shadow-sm">
          <ProcedurePicker selected={selected} onChange={setSelected} />
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
            <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
              {saving ? 'Saving…' : selected.length > 0 ? 'Save & Continue' : 'Continue'}
            </Button>
            <button type="button" onClick={() => router.push('/dashboard')} className="text-sm text-gray-500 hover:text-gray-700">
              Skip for now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
