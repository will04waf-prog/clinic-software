'use client'

import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const PRESET_GROUPS = [
  { label: 'Injectables',       items: ['Botox', 'Fillers', 'Lip Filler', 'Cheek Filler', 'PRP'] },
  { label: 'Face',              items: ['Rhinoplasty', 'Facelift', 'Eyelid Surgery', 'Brow Lift'] },
  { label: 'Body',              items: ['Breast Augmentation', 'Breast Reduction', 'Breast Lift', 'Tummy Tuck', 'Liposuction', 'BBL', 'Body Contouring', 'Mommy Makeover', 'Arm Lift'] },
  { label: 'Skin & Aesthetics', items: ['Chemical Peel', 'Microneedling', 'Laser Hair Removal', 'HydraFacial', 'Skin Tightening', 'Laser Resurfacing', 'Tattoo Removal'] },
  { label: 'Wellness',          items: ['Weight Loss', 'IV Therapy'] },
  { label: 'Other',             items: ['Other'] },
]

export const ALL_PRESET_LABELS = PRESET_GROUPS.flatMap((g) => g.items)

interface ProcedurePickerProps {
  selected: string[]
  onChange: (v: string[]) => void
}

export function ProcedurePicker({ selected, onChange }: ProcedurePickerProps) {
  const [input, setInput] = useState('')

  function toggle(label: string) {
    onChange(
      selected.includes(label)
        ? selected.filter((s) => s !== label)
        : [...selected, label],
    )
  }

  function addCustom() {
    const label = input.trim()
    if (!label || selected.includes(label)) { setInput(''); return }
    onChange([...selected, label])
    setInput('')
  }

  const customSelected = selected.filter((s) => !ALL_PRESET_LABELS.includes(s))

  return (
    <div className="space-y-5">
      {PRESET_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.items.map((item) => {
              const on = selected.includes(item)
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggle(item)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                    on
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-600'
                  }`}
                >
                  {item}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* Custom services already added */}
      {customSelected.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Custom</p>
          <div className="flex flex-wrap gap-2">
            {customSelected.map((label) => (
              <span
                key={label}
                className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700"
              >
                {label}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((s) => s !== label))}
                  className="ml-0.5 text-indigo-400 hover:text-indigo-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Add custom */}
      <div className="flex gap-2">
        <Input
          placeholder="Add custom service…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
          className="max-w-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={addCustom} disabled={!input.trim()}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
    </div>
  )
}
