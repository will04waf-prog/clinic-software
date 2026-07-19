'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'

type Status = 'idle' | 'submitting' | 'success' | 'error'

const TIME_OPTIONS = [
  '9:00 AM', '9:30 AM',
  '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM',
  '1:00 PM', '1:30 PM',
  '2:00 PM', '2:30 PM',
  '3:00 PM', '3:30 PM',
  '4:00 PM', '4:30 PM',
  '5:00 PM',
]

// Minimum selectable date: tomorrow
function getMinDate() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

export function BookDemoForm() {
  const pathname = usePathname()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setError('')

    const form = e.currentTarget
    const data = {
      name: (form.elements.namedItem('name') as HTMLInputElement).value.trim(),
      clinic_name: (form.elements.namedItem('clinic_name') as HTMLInputElement).value.trim(),
      email: (form.elements.namedItem('email') as HTMLInputElement).value.trim(),
      phone: (form.elements.namedItem('phone') as HTMLInputElement).value.trim(),
      preferred_date: (form.elements.namedItem('preferred_date') as HTMLInputElement).value,
      preferred_time: (form.elements.namedItem('preferred_time') as HTMLSelectElement).value,
      notes: (form.elements.namedItem('notes') as HTMLTextAreaElement).value.trim(),
      source: document.referrer || 'direct',
      page_path: pathname,
    }

    try {
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        // The API's error strings are English; this page is Spanish-first.
        // Map by status instead of echoing the server text.
        throw new Error(
          res.status === 429
            ? 'Demasiadas solicitudes — intente de nuevo en un minuto.'
            : res.status === 400
              ? 'Revise los campos e intente de nuevo.'
              : 'Algo salió mal. Intente de nuevo.',
        )
      }

      setStatus('success')
    } catch (err: any) {
      setError(err.message || 'Algo salió mal. Intente de nuevo.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 mb-4">
          <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Listo, lo llamamos.</h2>
        <p className="text-gray-500">
          Nos comunicamos en un día hábil para confirmar la hora.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">
            Su nombre <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="José García"
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>
        <div>
          <label htmlFor="clinic_name" className="block text-sm font-medium text-gray-700 mb-1.5">
            Nombre de su negocio <span className="text-red-500">*</span>
          </label>
          <input
            id="clinic_name"
            name="clinic_name"
            type="text"
            required
            placeholder="Jardinería García"
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
            Correo electrónico <span className="text-red-500">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="jose@ejemplo.com"
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1.5">
            Celular <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            placeholder="(305) 555-0123"
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>
      </div>

      {/* Preferred date + time */}
      <div>
        <p className="block text-sm font-medium text-gray-700 mb-1.5">
          Fecha y hora preferida <span className="text-gray-400 font-normal">(opcional)</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="preferred_date" className="sr-only">Preferred date</label>
            <input
              id="preferred_date"
              name="preferred_date"
              type="date"
              min={getMinDate()}
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="preferred_time" className="sr-only">Preferred time</label>
            <select
              id="preferred_time"
              name="preferred_time"
              defaultValue=""
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 bg-white"
            >
              <option value="">Cualquier hora</option>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-gray-400">Horario del Este (ET). Confirmamos disponibilidad.</p>
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1.5">
          ¿Algo que quiera contarnos? <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="p. ej. Hago unos 15 trabajos por semana y se me pierden llamadas cuando ando trabajando…"
          className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none"
        />
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-brand-400 text-white font-semibold rounded-lg px-6 py-3 text-sm transition-colors"
      >
        {status === 'submitting' ? 'Enviando…' : 'Pedir que me llamen'}
      </button>

      <p className="text-center text-xs text-gray-400">
        Respondemos en un día hábil. Sin spam, nunca.
      </p>
    </form>
  )
}
