'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { ContactAvatar } from '@/components/leads/contact-avatar'
import { FlagDraftButton } from '@/components/ai-twin/flag-draft-button'
import { cn } from '@/lib/utils'
import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditRow,
  type AuditPage,
  type SafetyIncidentKind,
  isAuditAction,
  DEFAULT_PAGE_SIZE,
} from '@/lib/ai-twin-audit'
import {
  VOICE_CLASS_LABEL,
  VOICE_EXAMPLE_CLASSES,
  type VoiceExampleClass,
} from '@/lib/voice-profile'

/**
 * /ai-twin/audit — Phase 2 W11.
 *
 * Filterable, paginated history of every AI Twin event for the org.
 * Filter state lives in URL params so the back button works.
 * Expandable rows reveal draft body + voice metadata from the
 * persisted context_snapshot. Auto-sent rows include an inline
 * FlagDraftButton so the owner can mark a send as wrong without
 * leaving the page.
 */

const ACTION_FILTERS: { key: AuditAction; label: string }[] = [
  { key: 'ai_draft_generated',                  label: 'Generated' },
  { key: 'ai_draft_sent',                       label: 'Sent' },
  { key: 'ai_draft_edited',                     label: 'Edited' },
  { key: 'ai_draft_rejected',                   label: 'Rejected' },
  { key: 'ai_twin_auto_sent',                   label: 'Auto-sent' },
  { key: 'ai_twin_auto_sent_flagged',           label: 'Flagged' },
  { key: 'ai_twin_auto_send_shadow_simulated',  label: 'Shadow simulated' },
  { key: 'ai_twin_auto_send_rollout_throttled', label: 'Rollout throttled' },
  { key: 'ai_twin_auto_send_settings_changed',  label: 'Settings changed' },
]

interface ActionBadge {
  label: string
  bg: string
  fg: string
}

function actionBadge(action: AuditAction): ActionBadge {
  switch (action) {
    case 'ai_draft_generated':                  return { label: 'Generated',        bg: '#0B202714', fg: '#14241D' }
    case 'ai_draft_sent':                       return { label: 'Sent',             bg: '#02C39A22', fg: '#04B08C' }
    case 'ai_draft_edited':                     return { label: 'Edited',           bg: '#02809022', fg: '#026B78' }
    case 'ai_draft_rejected':                   return { label: 'Rejected',         bg: '#14241D11', fg: '#14241D' }
    case 'ai_twin_auto_sent':                   return { label: 'Auto-sent',        bg: '#02809033', fg: '#028090' }
    case 'ai_twin_auto_sent_flagged':           return { label: 'Flagged',          bg: '#B5710F22', fg: '#B5710F' }
    case 'ai_twin_auto_send_settings_changed':  return { label: 'Settings changed', bg: '#0B202714', fg: '#14241D' }
    case 'ai_twin_auto_send_shadow_simulated':  return { label: 'Shadow simulated', bg: '#02809022', fg: '#026B78' }
    case 'ai_twin_auto_send_rollout_throttled': return { label: 'Rollout throttled',bg: '#B5710F18', fg: '#B5710F' }
  }
}

function safetyBadge(kind: SafetyIncidentKind): ActionBadge {
  switch (kind) {
    case 'guardrail_failed':   return { label: 'Guardrail caught',     bg: '#B5710F22', fg: '#B5710F' }
    case 'safety_trigger_held':return { label: 'Held by safety check', bg: '#B5710F22', fg: '#B5710F' }
    case 'flagged_after_send': return { label: 'Flagged by you',       bg: '#B5710F22', fg: '#B5710F' }
  }
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return 'just now'
  const m = Math.floor(diffMs / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

function isVoiceClass(v: string): v is VoiceExampleClass {
  return (VOICE_EXAMPLE_CLASSES as ReadonlyArray<string>).includes(v)
}

function AuditPageInner() {
  const router = useRouter()
  const sp = useSearchParams()

  // ── URL-driven filter state ──────────────────────────────────────
  const activeActions = useMemo<AuditAction[]>(() => {
    const raw = sp.get('action')
    if (!raw) return []
    return raw
      .split(',')
      .map(s => s.trim())
      .filter(isAuditAction)
  }, [sp])

  const fromIso = sp.get('from') ?? ''
  const toIso = sp.get('to') ?? ''
  const messageClass = (() => {
    const raw = sp.get('message_class')
    return raw && isVoiceClass(raw) ? raw : null
  })()
  const contactId = sp.get('contact_id') ?? ''
  const safetyOnly = sp.get('safety_only') === '1'

  const pageRaw = Number(sp.get('page') ?? '1')
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1

  const [data, setData] = useState<AuditPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (activeActions.length > 0) qs.set('action', activeActions.join(','))
      if (fromIso) qs.set('from', new Date(fromIso).toISOString())
      if (toIso)   qs.set('to',   new Date(toIso).toISOString())
      if (messageClass) qs.set('message_class', messageClass)
      if (contactId) qs.set('contact_id', contactId)
      if (safetyOnly) qs.set('safety_only', '1')
      if (page > 1) qs.set('page', String(page))
      const res = await fetch(`/api/ai-twin/audit?${qs.toString()}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`)
      }
      const json = (await res.json()) as AuditPage
      setData(json)
    } catch (err) {
      console.error('[ai-twin/audit] load failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load audit')
    } finally {
      setLoading(false)
    }
  }, [activeActions, fromIso, toIso, messageClass, contactId, safetyOnly, page])

  useEffect(() => { load() }, [load])

  function pushParams(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams()
    if (activeActions.length > 0) next.set('action', activeActions.join(','))
    if (fromIso) next.set('from', fromIso)
    if (toIso) next.set('to', toIso)
    if (messageClass) next.set('message_class', messageClass)
    if (contactId) next.set('contact_id', contactId)
    if (safetyOnly) next.set('safety_only', '1')
    if (page > 1) next.set('page', String(page))
    mutate(next)
    const qs = next.toString()
    router.push(qs ? `/ai-twin/audit?${qs}` : '/ai-twin/audit')
  }

  function toggleAction(a: AuditAction) {
    pushParams(next => {
      const current = new Set(activeActions)
      if (current.has(a)) current.delete(a)
      else current.add(a)
      next.delete('action')
      if (current.size > 0) next.set('action', Array.from(current).join(','))
      // Reset to page 1 whenever a filter changes.
      next.delete('page')
    })
  }
  function clearActions() {
    pushParams(next => {
      next.delete('action')
      next.delete('page')
    })
  }
  function setFromIso(v: string) {
    pushParams(next => {
      if (v) next.set('from', v); else next.delete('from')
      next.delete('page')
    })
  }
  function setToIso(v: string) {
    pushParams(next => {
      if (v) next.set('to', v); else next.delete('to')
      next.delete('page')
    })
  }
  function setMessageClass(v: string) {
    pushParams(next => {
      if (v && isVoiceClass(v)) next.set('message_class', v)
      else next.delete('message_class')
      next.delete('page')
    })
  }
  function setSafetyOnly(v: boolean) {
    pushParams(next => {
      if (v) next.set('safety_only', '1'); else next.delete('safety_only')
      next.delete('page')
    })
  }
  function clearContact() {
    pushParams(next => {
      next.delete('contact_id')
      next.delete('page')
    })
  }
  function setPage(next: number) {
    pushParams(p => {
      if (next > 1) p.set('page', String(next))
      else p.delete('page')
    })
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? DEFAULT_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeTo = total === 0 ? 0 : Math.min(total, page * pageSize)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#02C39A]/35 bg-[#F5EFE1] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-[#02C39A]/15">
            <ShieldCheck className="h-5 w-5 text-[#02C39A]" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-[#4A5A60]">AI Twin</p>
            <p
              className="text-[#14241D]"
              style={{
                fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
                fontSize: '22px',
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              Audit & safety
            </p>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="text-[12.5px] font-medium text-[#14241D]/70 hover:text-[#14241D]"
        >
          Back to dashboard
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-7">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5">

          {/* ── Filter bar ───────────────────────────────────── */}
          <section className="rounded-2xl border border-[#0B2027]/8 bg-[#FAF6EC] p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              {ACTION_FILTERS.map(({ key, label }) => {
                const active = activeActions.includes(key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleAction(key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors',
                      active
                        ? 'bg-[#0B2027] text-[#FAF6EC]'
                        : 'bg-white text-[#0B2027]/75 border border-[#0B2027]/12 hover:bg-[#0B2027]/4',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
              {activeActions.length > 0 && (
                <button
                  type="button"
                  onClick={clearActions}
                  className="text-[11.5px] font-medium text-[#14241D]/60 underline-offset-2 hover:underline ml-1"
                >
                  Clear actions
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11.5px] font-medium text-[#14241D]/65">
                From
                <input
                  type="date"
                  value={fromIso ? fromIso.slice(0, 10) : ''}
                  onChange={e => setFromIso(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  className="rounded-md border border-[#14241D]/15 bg-white px-2 py-1 text-[12.5px] text-[#14241D]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] font-medium text-[#14241D]/65">
                To
                <input
                  type="date"
                  value={toIso ? toIso.slice(0, 10) : ''}
                  onChange={e => setToIso(e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : '')}
                  className="rounded-md border border-[#14241D]/15 bg-white px-2 py-1 text-[12.5px] text-[#14241D]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] font-medium text-[#14241D]/65">
                Message class
                <select
                  value={messageClass ?? ''}
                  onChange={e => setMessageClass(e.target.value)}
                  className="rounded-md border border-[#14241D]/15 bg-white px-2 py-1 text-[12.5px] text-[#14241D]"
                >
                  <option value="">All classes</option>
                  {VOICE_EXAMPLE_CLASSES.map(c => (
                    <option key={c} value={c}>{VOICE_CLASS_LABEL[c]}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[12.5px] font-medium text-[#14241D]/85 ml-1">
                <input
                  type="checkbox"
                  checked={safetyOnly}
                  onChange={e => setSafetyOnly(e.target.checked)}
                  className="accent-[#B5710F]"
                />
                Safety incidents only
              </label>
              {contactId && (
                <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#02C39A]/15 px-2.5 py-0.5 text-[11.5px] font-medium text-[#04B08C]">
                  Filtered to one contact
                  <button
                    type="button"
                    onClick={clearContact}
                    className="text-[#04B08C] underline-offset-2 hover:underline"
                  >
                    clear
                  </button>
                </span>
              )}
            </div>
          </section>

          {/* ── Count + pagination header ────────────────────── */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-[#7E8C90]">
              {total === 0
                ? (safetyOnly
                    ? 'No safety incidents in this window — your guardrails are holding.'
                    : 'No AI Twin activity in this window.')
                : `Showing ${rangeFrom}–${rangeTo} of ${total}`}
            </span>
          </div>

          {/* ── Rows ─────────────────────────────────────────── */}
          {loading && !data ? (
            <ListSkeleton />
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-700">Failed to load audit</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
            </div>
          ) : data && data.rows.length === 0 ? (
            <div className="rounded-2xl border border-[#0B2027]/10 bg-[#FAF6EC] px-5 py-10 text-center">
              <p className="text-[13px] text-[#14241D]/65">
                {safetyOnly
                  ? 'No safety incidents in this window — your guardrails are holding.'
                  : 'No AI Twin activity matched these filters.'}
              </p>
            </div>
          ) : data ? (
            <div className="flex flex-col gap-2.5">
              {data.rows.map(row => (
                <AuditCard
                  key={row.id}
                  row={row}
                  expanded={expanded.has(row.id)}
                  onToggle={() => toggleExpanded(row.id)}
                  onChange={() => load()}
                />
              ))}
            </div>
          ) : null}

          {/* ── Pagination footer ────────────────────────────── */}
          {data && total > pageSize && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium border transition-colors',
                  page <= 1
                    ? 'border-[#0B2027]/10 text-[#0B2027]/30 cursor-not-allowed'
                    : 'border-[#0B2027]/12 text-[#14241D]/75 hover:bg-[#0B2027]/4',
                )}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </button>
              <span className="text-[12px] text-[#7E8C90]">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium border transition-colors',
                  page >= totalPages
                    ? 'border-[#0B2027]/10 text-[#0B2027]/30 cursor-not-allowed'
                    : 'border-[#0B2027]/12 text-[#14241D]/75 hover:bg-[#0B2027]/4',
                )}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[12.5px] text-[#7E8C90]">Loading…</div>}>
      <AuditPageInner />
    </Suspense>
  )
}

interface AuditCardProps {
  row: AuditRow
  expanded: boolean
  onToggle: () => void
  onChange: () => void
}

function AuditCard({ row, expanded, onToggle, onChange }: AuditCardProps) {
  const badge = actionBadge(row.action)
  const safety = row.safety_incident_kind ? safetyBadge(row.safety_incident_kind) : null
  const name =
    `${row.contact?.first_name ?? ''} ${row.contact?.last_name ?? ''}`.trim() || 'Unknown contact'
  const classLabel =
    row.draft?.message_class && isVoiceClass(row.draft.message_class)
      ? VOICE_CLASS_LABEL[row.draft.message_class as VoiceExampleClass]
      : null

  const isSettingsChange = row.action === 'ai_twin_auto_send_settings_changed'
  const draftExcerpt = row.draft?.draft_body
    ? row.draft.draft_body.length > 140
      ? row.draft.draft_body.slice(0, 140).trimEnd() + '…'
      : row.draft.draft_body
    : null

  return (
    <article className="rounded-2xl bg-[#FAF6EC] border border-[#0B2027]/8 px-4 py-3.5">
      <div className="flex items-start gap-3">
        {row.contact ? (
          <ContactAvatar
            firstName={row.contact.first_name}
            lastName={row.contact.last_name}
            size="md"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-[#0B2027]/8" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {row.contact ? (
              <Link
                href={`/leads/${row.contact.id}`}
                className="text-[14px] font-semibold text-[#14241D] hover:text-[#02C39A]"
              >
                {name}
              </Link>
            ) : (
              <span className="text-[14px] font-semibold text-[#14241D]">{name}</span>
            )}
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: badge.bg, color: badge.fg }}
            >
              {badge.label}
            </span>
            {safety && (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
                style={{ backgroundColor: safety.bg, color: safety.fg }}
              >
                {safety.label}
              </span>
            )}
            {classLabel && (
              <span className="inline-flex items-center rounded-full bg-[#028090]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#028090]">
                {classLabel}
              </span>
            )}
            <span className="ml-auto text-[11.5px] text-[#7E8C90]">
              {relativeTime(row.created_at)}
            </span>
          </div>

          {isSettingsChange ? (
            <SettingsChangeDetail metadata={row.metadata} />
          ) : draftExcerpt ? (
            <p className="mt-2 text-[12.5px] text-[#14241D]/80 line-clamp-2">
              <span className="font-semibold text-[#14241D]/60 mr-1">Draft:</span>
              {draftExcerpt}
            </p>
          ) : null}

          {row.action === 'ai_twin_auto_sent_flagged' && (
            <FlagReasonInline metadata={row.metadata} />
          )}

          <div className="mt-2 flex items-center justify-between gap-3">
            {row.draft ? (
              <button
                type="button"
                onClick={onToggle}
                className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#14241D]/65 hover:text-[#14241D]"
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {expanded ? 'Hide details' : 'Show details'}
              </button>
            ) : <span />}

            {row.action === 'ai_twin_auto_sent' && row.draft && (
              <FlagDraftButton
                draftId={row.draft.id}
                alreadyFlagged={row.already_flagged_by_me}
                onChange={onChange}
                size="sm"
              />
            )}
          </div>

          {expanded && row.draft && (
            <div className="mt-3 rounded-xl border border-[#14241D]/10 bg-white px-3 py-3 text-[12.5px] text-[#14241D]/85">
              <p className="font-semibold text-[#14241D]/60 text-[11px] uppercase tracking-wide mb-1">
                Full draft
              </p>
              <p className="whitespace-pre-wrap">{row.draft.draft_body || <span className="italic text-[#7E8C90]">empty</span>}</p>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] text-[#14241D]/65">
                <div><span className="font-semibold text-[#14241D]/55">State:</span> {row.draft.state}</div>
                {row.draft.message_class && (
                  <div><span className="font-semibold text-[#14241D]/55">Class:</span> {row.draft.message_class}</div>
                )}
                {typeof row.draft.edit_distance === 'number' && (
                  <div><span className="font-semibold text-[#14241D]/55">Edit distance:</span> {row.draft.edit_distance}</div>
                )}
                {typeof row.draft.voice_examples_used === 'number' && (
                  <div><span className="font-semibold text-[#14241D]/55">Voice examples used:</span> {row.draft.voice_examples_used}</div>
                )}
                {row.draft.guardrail_violation && (
                  <div><span className="font-semibold text-[#14241D]/55">Guardrail:</span> {row.draft.guardrail_violation}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function FlagReasonInline({ metadata }: { metadata: Record<string, unknown> }) {
  const code = typeof metadata['reason_code'] === 'string' ? (metadata['reason_code'] as string) : null
  const text = typeof metadata['reason_text'] === 'string' ? (metadata['reason_text'] as string) : null
  if (!code && !text) return null
  return (
    <p className="mt-1.5 text-[12px] text-[#B5710F]">
      {code && <span className="font-semibold mr-1">Reason: {code.replace(/_/g, ' ')}.</span>}
      {text}
    </p>
  )
}

function SettingsChangeDetail({ metadata }: { metadata: Record<string, unknown> }) {
  // The W9 settings card writes whatever shape it chose; we just
  // pretty-print the keys we know about and fall back to JSON.
  const before = metadata['before']
  const after = metadata['after']
  if (before && after) {
    return (
      <div className="mt-2 grid grid-cols-2 gap-3 text-[11.5px] text-[#14241D]/75">
        <div>
          <p className="font-semibold text-[#14241D]/55 mb-0.5">Before</p>
          <pre className="whitespace-pre-wrap bg-white rounded-md border border-[#14241D]/10 px-2 py-1 text-[11.5px]">{stringify(before)}</pre>
        </div>
        <div>
          <p className="font-semibold text-[#14241D]/55 mb-0.5">After</p>
          <pre className="whitespace-pre-wrap bg-white rounded-md border border-[#14241D]/10 px-2 py-1 text-[11.5px]">{stringify(after)}</pre>
        </div>
      </div>
    )
  }
  return (
    <p className="mt-2 text-[12px] text-[#14241D]/70">
      Autonomous-send settings were changed.
    </p>
  )
}

function stringify(v: unknown): string {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 animate-pulse">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="h-24 rounded-2xl bg-[#0B2027]/5" />
      ))}
    </div>
  )
}

// AUDIT_ACTIONS is re-exported through ai-twin-audit; suppress an
// unused-symbol warning if any of the imported constants are only
// referenced indirectly.
void AUDIT_ACTIONS
