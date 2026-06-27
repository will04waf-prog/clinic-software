'use client'

/**
 * Phase 5 W2 — FAQ list with inline add / edit / remove / reorder.
 *
 * State model: the server passes the canonical FAQ list as `initial`.
 * The client mirrors it in local state and replaces the whole array
 * after every successful server action (the actions return the
 * authoritative `faqs` payload). That keeps the client in lockstep
 * with the DB without a router.refresh() roundtrip — useful here
 * because the list is interactive and the refresh would lose the
 * "now editing row X" UI state.
 *
 * Reorder UX: drag-and-drop would be nice but @dnd-kit/sortable
 * isn't in our deps and pulling it in for this single surface isn't
 * worth the bytes. Up/down buttons cover the use case: an owner
 * typically wants to bump a frequently-asked FAQ to the top, not
 * shuffle 30 of them. Both buttons call reorderFaqs with the full
 * id sequence so the server validates the move against the current
 * corpus state — a stale tab gets a friendly refresh-and-try-again.
 */

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FaqEditor } from './faq-editor'
import {
  addFaq,
  removeFaq,
  reorderFaqs,
  updateFaq,
  type FaqRow,
} from '@/app/(dashboard)/settings/faqs/actions'

const MAX_FAQS = 100

export function FaqList({ initial }: { initial: FaqRow[] }) {
  // Local mirror of the server's canonical array. We DO NOT call
  // router.refresh() after mutations — the server actions return the
  // already-normalized rows, and replacing local state in-place
  // preserves the "which row is being edited" UI.
  const [rows, setRows]       = useState<FaqRow[]>(initial)
  const [adding, setAdding]   = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function applyResult(result: { ok: true; faqs: FaqRow[] } | { ok: false; error: string }) {
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setRows(result.faqs)
    setError(null)
    return true
  }

  function handleAdd(value: { question: string; answer: string; tags: string[] }) {
    setError(null)
    startTransition(async () => {
      const result = await addFaq(value)
      if (applyResult(result)) setAdding(false)
    })
  }

  function handleUpdate(id: string, value: { question: string; answer: string; tags: string[] }) {
    setError(null)
    startTransition(async () => {
      const result = await updateFaq({ id, ...value })
      if (applyResult(result)) setEditingId(null)
    })
  }

  function handleRemove(id: string) {
    // No confirm() prompt — the action is reversible (re-add) and
    // adding a modal here would be friction in the common case of
    // pruning typos during initial setup. The optimistic remove also
    // keeps the editing-state UI predictable.
    setError(null)
    startTransition(async () => {
      const result = await removeFaq({ id })
      applyResult(result)
      if (editingId === id) setEditingId(null)
    })
  }

  function handleMove(id: string, delta: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === id)
    if (idx < 0) return
    const target = idx + delta
    if (target < 0 || target >= rows.length) return
    const next = rows.slice()
    const [moved] = next.splice(idx, 1)
    next.splice(target, 0, moved)
    const orderedIds = next.map((r) => r.id)

    // Optimistic: reflect the move locally now, then reconcile from
    // the server response (which returns the canonical rows with
    // refreshed position values). On error we revert to the
    // server-authoritative `rows` by re-fetching — but in practice
    // the only reason this fails is a stale corpus (add/remove in
    // another tab), where the friendly "refresh and try again" error
    // is the right UX.
    setRows(next)
    setError(null)
    startTransition(async () => {
      const result = await reorderFaqs({ orderedIds })
      applyResult(result)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Custom FAQs</span>
          <span className="text-xs font-normal text-gray-500">
            {rows.length}/{MAX_FAQS}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        {rows.length === 0 && !adding && (
          <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
            No FAQs yet. Add the questions your front desk fields most often — payment methods, parking, insurance, cancellation policy.
          </p>
        )}

        <ul className="space-y-2">
          {rows.map((row, idx) => (
            <li
              key={row.id}
              className="rounded-md border border-gray-200 bg-white px-3 py-2.5"
            >
              {editingId === row.id ? (
                <FaqEditor
                  initial={{ question: row.question, answer: row.answer, tags: row.tags ?? [] }}
                  submitting={pending}
                  onSubmit={(v) => handleUpdate(row.id, v)}
                  onCancel={() => { setEditingId(null); setError(null) }}
                  submitLabel="Save FAQ"
                />
              ) : (
                <div className="flex items-start gap-2">
                  <div className="flex flex-col gap-0.5 pt-0.5">
                    <button
                      type="button"
                      title="Move up"
                      aria-label="Move up"
                      disabled={pending || idx === 0}
                      onClick={() => handleMove(row.id, -1)}
                      className="rounded p-0.5 text-gray-400 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Move down"
                      aria-label="Move down"
                      disabled={pending || idx === rows.length - 1}
                      onClick={() => handleMove(row.id, 1)}
                      className="rounded p-0.5 text-gray-400 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[#14241d]">{row.question}</p>
                    <p className="mt-0.5 text-xs text-gray-600 whitespace-pre-wrap">{row.answer}</p>
                    {row.tags && row.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {row.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => { setEditingId(row.id); setAdding(false); setError(null) }}
                      title="Edit FAQ"
                      aria-label="Edit FAQ"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => handleRemove(row.id)}
                      title="Remove FAQ"
                      aria-label="Remove FAQ"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {adding ? (
          <div className="rounded-md border border-brand-200 bg-brand-50/40 px-3 py-3">
            <FaqEditor
              submitting={pending}
              onSubmit={handleAdd}
              onCancel={() => { setAdding(false); setError(null) }}
              submitLabel="Add FAQ"
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={pending || rows.length >= MAX_FAQS}
            onClick={() => { setAdding(true); setEditingId(null); setError(null) }}
            className="w-full"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {rows.length >= MAX_FAQS ? 'FAQ limit reached' : 'Add FAQ'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
