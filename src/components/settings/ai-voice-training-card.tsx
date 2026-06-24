'use client'
import { useCallback, useEffect, useState } from 'react'
import { Sparkles, Plus, Trash2, Save, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Phase 2 Week 6 — Voice training Settings card.
 *
 * Two halves:
 *   1. Voice profile: tone sliders + banned phrases + custom sign-off.
 *   2. Voice examples: paste 5-10 example messages, each tagged with
 *      a class (greeting / faq / follow-up / etc).
 *
 * No effect on drafts yet — W7 wires the profile + examples into
 * generateDraft() as few-shot prompts. This week is pure
 * data-collection plumbing. The "Drafts use your voice from
 * tomorrow" hint at the bottom reflects that honestly.
 *
 * Loads via /api/org/voice-profile + /api/org/voice-examples on
 * mount. Saves the profile on a single button (debounced via dirty
 * flag). Examples save individually on add/delete.
 */

const EXAMPLE_CLASSES = [
  { value: 'greeting',        label: 'Welcome / first reply' },
  { value: 'faq',             label: 'Answering a question' },
  { value: 'follow_up',       label: 'Follow-up nudge' },
  { value: 'consult_confirm', label: 'Consult confirmation' },
  { value: 'follow_up_cold',  label: 'Re-engaging cold lead' },
  { value: 'custom',          label: 'Other' },
] as const

type ExampleClass = typeof EXAMPLE_CLASSES[number]['value']

interface VoiceProfile {
  tone_formal: number
  tone_warm: number
  banned_phrases: string[]
  custom_signoff: string | null
}

interface VoiceExample {
  id: string
  class: ExampleClass
  label: string | null
  body: string
  created_at: string
  updated_at: string
}

const TONE_FORMAL_LABELS = ['Casual', 'Conversational', 'Balanced', 'Polished', 'Formal']
const TONE_WARM_LABELS   = ['Very warm', 'Warm', 'Balanced', 'Efficient', 'Clinical']

function bucketLabel(value: number, labels: string[]): string {
  const idx = Math.min(labels.length - 1, Math.max(0, Math.floor((value / 100) * labels.length)))
  return labels[idx]
}

export function AiVoiceTrainingCard() {
  const [profile, setProfile] = useState<VoiceProfile | null>(null)
  const [examples, setExamples] = useState<VoiceExample[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile] = useState(false)
  const [profileDirty, setProfileDirty] = useState(false)
  const [newPhrase, setNewPhrase] = useState('')

  // New-example form state.
  const [newClass, setNewClass] = useState<ExampleClass>('greeting')
  const [newLabel, setNewLabel] = useState('')
  const [newBody, setNewBody] = useState('')
  const [addingExample, setAddingExample] = useState(false)
  const [exampleError, setExampleError] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [pRes, eRes] = await Promise.all([
        fetch('/api/org/voice-profile',  { cache: 'no-store' }),
        fetch('/api/org/voice-examples', { cache: 'no-store' }),
      ])
      if (!pRes.ok) throw new Error('Failed to load voice profile')
      if (!eRes.ok) throw new Error('Failed to load voice examples')
      const { profile: pData } = await pRes.json()
      const { examples: eData } = await eRes.json()
      setProfile(pData)
      setExamples(eData)
    } catch (err: any) {
      setError(err.message ?? 'Failed to load voice settings')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  function updateProfile<K extends keyof VoiceProfile>(key: K, value: VoiceProfile[K]) {
    setProfile(p => (p ? { ...p, [key]: value } : p))
    setProfileDirty(true)
    setSavedProfile(false)
  }

  async function saveProfile() {
    if (!profile) return
    setSavingProfile(true)
    setError('')
    try {
      const res = await fetch('/api/org/voice-profile', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(profile),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'Save failed')
      }
      const { profile: p } = await res.json()
      setProfile(p)
      setProfileDirty(false)
      setSavedProfile(true)
    } catch (err: any) {
      setError(err.message ?? 'Save failed')
    } finally {
      setSavingProfile(false)
    }
  }

  function addBannedPhrase() {
    const trimmed = newPhrase.trim()
    if (!trimmed || !profile) return
    if (profile.banned_phrases.includes(trimmed)) return
    updateProfile('banned_phrases', [...profile.banned_phrases, trimmed])
    setNewPhrase('')
  }

  function removeBannedPhrase(p: string) {
    if (!profile) return
    updateProfile('banned_phrases', profile.banned_phrases.filter(x => x !== p))
  }

  async function addExample() {
    if (!newBody.trim()) return
    setAddingExample(true)
    setExampleError('')
    try {
      const res = await fetch('/api/org/voice-examples', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          class: newClass,
          label: newLabel.trim() || null,
          body:  newBody.trim(),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'Add failed')
      }
      const { example } = await res.json()
      setExamples(prev => [example, ...prev])
      setNewLabel('')
      setNewBody('')
    } catch (err: any) {
      setExampleError(err.message ?? 'Add failed')
    } finally {
      setAddingExample(false)
    }
  }

  async function deleteExample(id: string) {
    const prev = examples
    setExamples(p => p.filter(x => x.id !== id))
    try {
      const res = await fetch(`/api/org/voice-examples/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
    } catch (err: any) {
      setExamples(prev)
      setError(err.message ?? 'Delete failed')
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Twin · Voice training</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">Loading…</p>
        </CardContent>
      </Card>
    )
  }
  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Twin · Voice training</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error || 'Voice training is unavailable.'}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#02C39A]" fill="currentColor" />
          AI Twin · Voice training
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">

        {/* ── Tone sliders ──────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <p className="font-medium text-gray-900">Tone</p>
            <p className="text-xs text-gray-400 mt-0.5">
              How does your clinic naturally talk to patients?
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="tone-formal" className="text-xs text-gray-600">Formal</label>
              <span className="text-xs font-medium text-[#028090]">{bucketLabel(profile.tone_formal, TONE_FORMAL_LABELS)}</span>
            </div>
            <input
              id="tone-formal"
              type="range"
              min={0}
              max={100}
              value={profile.tone_formal}
              onChange={e => updateProfile('tone_formal', Number(e.target.value))}
              className="w-full accent-[#02C39A]"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>Casual</span><span>Formal</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="tone-warm" className="text-xs text-gray-600">Warmth</label>
              <span className="text-xs font-medium text-[#028090]">{bucketLabel(profile.tone_warm, TONE_WARM_LABELS)}</span>
            </div>
            <input
              id="tone-warm"
              type="range"
              min={0}
              max={100}
              value={profile.tone_warm}
              onChange={e => updateProfile('tone_warm', Number(e.target.value))}
              className="w-full accent-[#02C39A]"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>Very warm</span><span>Clinical</span>
            </div>
          </div>
        </section>

        {/* ── Banned phrases ────────────────────────────────── */}
        <section className="space-y-3 border-t border-gray-100 pt-5">
          <div>
            <p className="font-medium text-gray-900">Banned phrases</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Words the AI must never use. Add anything that doesn't sound like your clinic.
            </p>
          </div>

          {profile.banned_phrases.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {profile.banned_phrases.map(p => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 rounded-full bg-[#0B2027]/8 px-2 py-0.5 text-[11.5px] text-[#14241D]"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => removeBannedPhrase(p)}
                    className="text-gray-400 hover:text-red-500"
                    aria-label={`Remove ${p}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={newPhrase}
              onChange={e => setNewPhrase(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBannedPhrase() } }}
              placeholder='e.g. "amazing", "perfect"'
              maxLength={60}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#02C39A]/40 focus:border-[#02C39A]/40"
            />
            <button
              type="button"
              onClick={addBannedPhrase}
              disabled={!newPhrase.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-[#14241D] px-3 py-2 text-[12.5px] font-semibold text-[#FAF6EC] hover:bg-[#1E342A] transition-colors disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </section>

        {/* ── Sign-off ──────────────────────────────────────── */}
        <section className="space-y-3 border-t border-gray-100 pt-5">
          <div>
            <p className="font-medium text-gray-900">Custom sign-off</p>
            <p className="text-xs text-gray-400 mt-0.5">
              How you usually end a message. Leave blank to use the clinic name only.
            </p>
          </div>
          <input
            type="text"
            value={profile.custom_signoff ?? ''}
            onChange={e => updateProfile('custom_signoff', e.target.value || null)}
            placeholder='e.g. "— The Lumière team xo"'
            maxLength={80}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#02C39A]/40 focus:border-[#02C39A]/40"
          />
        </section>

        {/* ── Save profile ──────────────────────────────────── */}
        <div className="flex items-center gap-3 border-t border-gray-100 pt-5">
          <button
            type="button"
            onClick={saveProfile}
            disabled={savingProfile || !profileDirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#02C39A] px-4 py-2 text-[13px] font-semibold text-[#0B2027] hover:bg-[#04B08C] transition-colors disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {savingProfile ? 'Saving…' : savedProfile && !profileDirty ? 'Saved' : 'Save tone & phrases'}
          </button>
          {error && (
            <p className="inline-flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="h-3 w-3" />
              {error}
            </p>
          )}
        </div>

        {/* ── Example messages ──────────────────────────────── */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <div>
            <p className="font-medium text-gray-900">Example messages</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Paste 5-10 short messages you've written to patients. The AI uses these
              as examples to match your specific voice. Tag each with what kind of
              message it is.
            </p>
          </div>

          {/* New example form */}
          <div className="rounded-lg border border-gray-200 bg-[#FAF6EC]/40 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newClass}
                onChange={e => setNewClass(e.target.value as ExampleClass)}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#02C39A]/40"
              >
                {EXAMPLE_CLASSES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Optional label"
                maxLength={80}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#02C39A]/40"
              />
            </div>
            <textarea
              value={newBody}
              onChange={e => setNewBody(e.target.value)}
              placeholder='Paste an example message exactly how you would type it'
              maxLength={600}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#02C39A]/40 focus:border-[#02C39A]/40"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-gray-400">{newBody.length}/600</span>
              <button
                type="button"
                onClick={addExample}
                disabled={!newBody.trim() || addingExample}
                className="inline-flex items-center gap-1 rounded-lg bg-[#14241D] px-3 py-1.5 text-[12px] font-semibold text-[#FAF6EC] hover:bg-[#1E342A] transition-colors disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                {addingExample ? 'Adding…' : 'Add example'}
              </button>
            </div>
            {exampleError && <p className="text-xs text-red-600">{exampleError}</p>}
          </div>

          {/* Examples list */}
          {examples.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No examples yet. Add a few to teach the AI how you talk.</p>
          ) : (
            <ul className="space-y-2">
              {examples.map(ex => {
                const classLabel = EXAMPLE_CLASSES.find(c => c.value === ex.class)?.label ?? ex.class
                return (
                  <li key={ex.id} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="rounded-full bg-[#02C39A]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#04B08C]">
                          {classLabel}
                        </span>
                        {ex.label && (
                          <span className="truncate text-[12px] font-medium text-gray-700">{ex.label}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteExample(ex.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        aria-label="Delete example"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-[13px] text-gray-700 whitespace-pre-line">{ex.body}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Phase 2 W7+ reality: voice is live in drafts. */}
        <div className="rounded-lg bg-[#02C39A]/10 border border-[#02C39A]/30 px-3 py-2 text-[12px] text-[#04B08C]">
          <p className="font-semibold">Your drafts are tuned to this voice</p>
          <p className="mt-0.5 text-[#026B78]">
            AI drafts use your tone settings and pull matching examples into the
            prompt. See "Voice training health" below to track how well it's
            working over time.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
