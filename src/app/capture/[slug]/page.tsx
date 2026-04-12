'use client'
import { useEffect, useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

const PROCEDURES = [
  { value: 'rhinoplasty',        label: 'Rhinoplasty' },
  { value: 'bbl',                label: 'BBL' },
  { value: 'liposuction',        label: 'Liposuction' },
  { value: 'breast_augmentation',label: 'Breast Augmentation' },
  { value: 'breast_reduction',   label: 'Breast Reduction' },
  { value: 'tummy_tuck',         label: 'Tummy Tuck' },
  { value: 'facelift',           label: 'Facelift' },
  { value: 'blepharoplasty',     label: 'Blepharoplasty' },
  { value: 'botox',              label: 'Botox' },
  { value: 'fillers',            label: 'Fillers' },
  { value: 'other',              label: 'Other' },
]

export default function CaptureFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const [slug, setSlug]   = useState('')
  const [orgName, setOrgName] = useState('')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [firstName, setFirstName]       = useState('')
  const [lastName, setLastName]         = useState('')
  const [email, setEmail]               = useState('')
  const [phone, setPhone]               = useState('')
  const [notes, setNotes]               = useState('')
  const [procedures, setProcedures]     = useState<string[]>([])

  useEffect(() => {
    params.then(({ slug: s }) => {
      setSlug(s)
      fetch(`/api/capture/${s}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.error) { setNotFound(true) }
          else { setOrgName(j.org.name) }
        })
        .catch(() => setNotFound(true))
        .finally(() => setLoading(false))
    })
  }, [params])

  function toggleProcedure(value: string) {
    setProcedures((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim()) { setError('First name is required'); return }
    if (!email.trim() && !phone.trim()) { setError('Please provide an email or phone number'); return }

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/capture/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name:  lastName.trim() || undefined,
          email:      email.trim() || undefined,
          phone:      phone.trim() || undefined,
          notes:      notes.trim() || undefined,
          procedure_interest: procedures,
        }),
      })

      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Submission failed'); return }
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Form not found</h1>
        <p className="mt-2 text-gray-500">This consultation request form is not available.</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle className="h-8 w-8 text-emerald-600" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Request received!</h1>
        <p className="mt-2 text-gray-500 max-w-sm">
          Thank you for your interest. A member of the {orgName} team will be in touch soon.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">{orgName}</h1>
          <p className="mt-1 text-gray-500">Request a consultation</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="first_name">First name <span className="text-red-500">*</span></Label>
              <Input id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Last name</Label>
              <Input id="last_name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 000-0000" />
          </div>

          <div className="space-y-2">
            <Label>Procedures of interest</Label>
            <div className="flex flex-wrap gap-2">
              {PROCEDURES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => toggleProcedure(p.value)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                    procedures.includes(p.value)
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Additional notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything you'd like us to know before your consultation..."
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Request Consultation'}
          </Button>

          <p className="text-center text-xs text-gray-400">
            Your information is kept private and never shared.
          </p>
        </form>
      </div>
    </div>
  )
}
