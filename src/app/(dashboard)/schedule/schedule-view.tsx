'use client'

/**
 * CRM-pivot LOOP — Schedule agenda (client).
 *
 * A simple day-list of the org's jobs, grouped into "Hoy" (today +
 * anything overdue and still open) and "Próximos" (future). Each row is
 * one job: the client's name, the job title, a status pill, and a
 * one-tap "Marcar completado" action that PATCHes /api/jobs and updates
 * the row in place. Mobile-first, Spanish-default.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, Loader2 } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'canceled'

interface Job {
  id: string
  title: string | null
  scheduled_date: string | null
  status: JobStatus
  completed_at: string | null
  contact_first_name: string | null
}

/** Local YYYY-MM-DD for "today" — matches the DATE column's format and
 *  sorts lexically = chronologically. */
function todayLocalISO(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function formatDate(iso: string | null, locale: Locale): string {
  if (!iso) return ''
  // Parse as a local date (avoid UTC shift on a bare YYYY-MM-DD).
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function StatusPill({ status, locale }: { status: JobStatus; locale: Locale }) {
  const t = dict(locale).job
  const map: Record<JobStatus, { label: string; className: string }> = {
    scheduled:   { label: t.statusScheduled,  className: 'bg-[#028090]/10 text-[#028090]' },
    in_progress: { label: t.statusInProgress, className: 'bg-amber-100 text-amber-700' },
    completed:   { label: t.statusCompleted,  className: 'bg-[#02C39A]/15 text-[#0B7A5E]' },
    // No dict key for canceled yet — local literal (note to i18n owner).
    canceled:    { label: locale === 'es' ? 'Cancelado' : 'Canceled', className: 'bg-gray-100 text-gray-500' },
  }
  const { label, className } = map[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${className}`}>
      {label}
    </span>
  )
}

export function ScheduleView({ locale }: { locale: Locale }) {
  const t = dict(locale).job
  const common = dict(locale).common
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      setJobs(Array.isArray(body?.jobs) ? body.jobs : [])
    } catch (err: any) {
      setError(err?.message ?? 'Error')
      setJobs([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const markComplete = useCallback(async (id: string) => {
    setPending((p) => ({ ...p, [id]: true }))
    try {
      const res = await fetch('/api/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'completed' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      const updated = body?.job
      setJobs((prev) =>
        (prev ?? []).map((j) =>
          j.id === id
            ? { ...j, status: 'completed', completed_at: updated?.completed_at ?? new Date().toISOString() }
            : j,
        ),
      )
    } catch {
      // Silent: the row simply stays as-is; the owner can retry.
    } finally {
      setPending((p) => ({ ...p, [id]: false }))
    }
  }, [])

  const { today, upcoming } = useMemo(() => {
    const list = jobs ?? []
    const t0 = todayLocalISO()
    const today: Job[] = []
    const upcoming: Job[] = []
    for (const j of list) {
      const d = j.scheduled_date ?? ''
      // Today + overdue-but-open land in "Hoy"; strictly-future in "Próximos".
      if (d && d > t0) upcoming.push(j)
      else today.push(j)
    }
    return { today, upcoming }
  }, [jobs])

  const isEmpty = jobs !== null && jobs.length === 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#02C39A]/35 bg-[#F5EFE1] px-4 sm:px-6">
        <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-[#02C39A]/15">
          <CalendarDays className="h-5 w-5 text-[#028090]" />
        </span>
        <h1
          className="text-[#0B2027]"
          style={{
            fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
            fontSize: '22px',
            fontWeight: 600,
          }}
        >
          {t.scheduleTitle}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-[720px] flex-col gap-8">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p>
          )}
          {jobs === null ? (
            <div className="w-full space-y-2.5 animate-pulse" aria-label={common.loading}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-black/5" />
              ))}
            </div>
          ) : isEmpty ? (
            <div className="rounded-2xl border border-dashed border-[#02C39A]/40 bg-white/60 px-6 py-14 text-center">
              <CalendarDays className="mx-auto mb-3 h-8 w-8 text-[#02C39A]" />
              <p className="text-[15px] font-medium text-[#0B2027]">{t.empty}</p>
            </div>
          ) : (
            <>
              {today.length > 0 && (
                <JobGroup
                  heading={t.today}
                  jobs={today}
                  locale={locale}
                  showDate={false}
                  pending={pending}
                  onComplete={markComplete}
                />
              )}
              {upcoming.length > 0 && (
                <JobGroup
                  heading={t.upcoming}
                  jobs={upcoming}
                  locale={locale}
                  showDate
                  pending={pending}
                  onComplete={markComplete}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function JobGroup({
  heading,
  jobs,
  locale,
  showDate,
  pending,
  onComplete,
}: {
  heading: string
  jobs: Job[]
  locale: Locale
  showDate: boolean
  pending: Record<string, boolean>
  onComplete: (id: string) => void
}) {
  const t = dict(locale).job
  return (
    <section>
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-[#7E8C90]">{heading}</h2>
      <div className="flex flex-col gap-2.5">
        {jobs.map((job) => {
          const done = job.status === 'completed'
          const busy = !!pending[job.id]
          return (
            <div
              key={job.id}
              className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[15px] font-semibold text-[#0B2027]">
                    {job.contact_first_name || (locale === 'es' ? 'Cliente' : 'Client')}
                  </p>
                  <StatusPill status={job.status} locale={locale} />
                </div>
                <p className="truncate text-[13px] text-[#5A6A70]">{job.title || '—'}</p>
                {showDate && job.scheduled_date && (
                  <p className="mt-0.5 text-[12px] text-[#A4AFB2]">{formatDate(job.scheduled_date, locale)}</p>
                )}
              </div>
              {done ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[#0B7A5E]">
                  <Check className="h-4 w-4" />
                  {t.completed}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onComplete(job.id)}
                  disabled={busy}
                  className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#028090] px-3.5 py-2 text-sm font-semibold text-white sm:w-auto sm:rounded-full shadow-[0_2px_6px_-2px_rgba(2,128,144,0.5)] transition-colors hover:bg-[#026B78] disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={2.6} />}
                  {t.markComplete}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
