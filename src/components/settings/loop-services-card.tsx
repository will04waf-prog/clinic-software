'use client'

import { useState } from 'react'
import { Check, Plus, Wrench } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'
import { LOOP_SERVICE_PRESETS } from '@/lib/vertical/config'

// Loop-family replacement for the med-spa ServicesCard: vertical-aware
// presets (Spanish-first) + owner-defined custom services, saved to the
// SAME organizations.procedures column via PATCH /api/org/procedures —
// UI-only difference, zero schema change. Med-spa keeps its own picker.
export function LoopServicesCard({
  locale,
  vertical,
  initial,
}: {
  locale: Locale
  vertical: 'landscaping' | 'trades' | 'cleaning'
  initial: string[] | null
}) {
  const t = dict(locale).services
  const presets = LOOP_SERVICE_PRESETS[vertical][locale]

  const initialList = initial ?? []
  const [selected, setSelected] = useState<string[]>(initialList)
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<'ok' | 'err' | null>(null)

  // Presets + any saved services that aren't presets (owner customs).
  const customs = selected.filter((s) => !presets.includes(s))
  const allChips = [...presets, ...customs]

  function toggle(name: string) {
    setFlash(null)
    setSelected((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]))
  }

  function addCustom() {
    const name = custom.trim()
    if (!name) return
    setCustom('')
    setFlash(null)
    setSelected((prev) => (prev.includes(name) ? prev : [...prev, name]))
  }

  async function save() {
    setSaving(true)
    setFlash(null)
    try {
      const res = await fetch('/api/org/procedures', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ procedures: selected }),
      })
      setFlash(res.ok ? 'ok' : 'err')
    } catch {
      setFlash('err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#028090]/10 text-[#028090]">
          <Wrench className="h-5 w-5" />
        </span>
        <h3 className="text-base font-semibold text-[#0B2027]">{t.title}</h3>
      </div>
      <p className="mt-2 text-sm text-gray-500">{t.hint}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {allChips.map((name) => {
          const on = selected.includes(name)
          return (
            <button
              key={name}
              type="button"
              onClick={() => toggle(name)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${
                on
                  ? 'border-[#028090] bg-[#028090]/10 text-[#028090]'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {on && <Check className="h-3.5 w-3.5" />}
              {name}
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
          placeholder={t.addPlaceholder}
          className="h-11 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-base text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        />
        <button
          type="button"
          onClick={addCustom}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <Plus className="h-4 w-4" /> {t.add}
        </button>
      </div>

      {flash === 'ok' && <p className="mt-3 text-sm font-medium text-[#0B7A5E]">{t.saved}</p>}
      {flash === 'err' && <p className="mt-3 text-sm text-red-600">{t.error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-brand px-5 text-sm font-semibold text-white active:scale-[.99] disabled:opacity-60 sm:w-auto"
      >
        {saving ? dict(locale).common.saving : t.save}
      </button>
    </div>
  )
}
