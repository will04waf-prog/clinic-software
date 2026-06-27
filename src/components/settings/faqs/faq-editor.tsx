'use client'

/**
 * Phase 5 W2 — Per-row editor used inside FaqList.
 *
 * Renders either an existing FAQ in edit mode or a blank "add new"
 * form. The component is intentionally stateless about which
 * lifecycle it's in — the parent passes an optional `initial` (edit)
 * or omits it (add), and the `onSubmit` callback determines whether
 * the parent calls addFaq or updateFaq. This keeps the editor reusable
 * and lets the parent own the round-trip / refresh state.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Mirrors the server-side caps in actions.ts. We re-encode them here
// so the input maxLength / counter UI works without an extra import
// — the server is the authoritative gate, this is just a UX hint.
const QUESTION_MAX  = 200
const ANSWER_MAX    = 800
const TAG_MAX_LEN   = 40
const TAG_MAX_COUNT = 8

export interface FaqEditorValue {
  question: string
  answer:   string
  tags:     string[]
}

export interface FaqEditorProps {
  initial?: FaqEditorValue
  submitting?: boolean
  error?:    string | null
  onSubmit:  (value: FaqEditorValue) => void | Promise<void>
  onCancel?: () => void
  submitLabel?: string
}

export function FaqEditor({
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: FaqEditorProps) {
  const [question, setQuestion] = useState<string>(initial?.question ?? '')
  const [answer,   setAnswer]   = useState<string>(initial?.answer   ?? '')
  // Tags are edited as a comma-separated string in the input so the
  // owner can type "insurance, carecredit, financing" without a tag
  // chip UI. We split + trim on submit; empty entries get dropped
  // server-side too (defense in depth).
  const [tagsRaw, setTagsRaw] = useState<string>((initial?.tags ?? []).join(', '))

  function handleSubmit() {
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      // Hard cap at TAG_MAX_COUNT before the server even sees the
      // input — the server also enforces this but the UX is clearer
      // if a 9th tag never appears to take.
      .slice(0, TAG_MAX_COUNT)
    void onSubmit({ question: question.trim(), answer: answer.trim(), tags })
  }

  const disabled = !!submitting

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="faq-question">Question</Label>
        <Input
          id="faq-question"
          placeholder="Do you accept Care Credit?"
          value={question}
          maxLength={QUESTION_MAX}
          disabled={disabled}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <p className="text-[11px] text-gray-500">
          {question.length}/{QUESTION_MAX} — write it the way a caller would actually ask. Layla will fuzzy-match against this.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="faq-answer">Answer</Label>
        <textarea
          id="faq-answer"
          placeholder="Yes — we accept Care Credit, Cherry, and all major credit cards. Cash and check are also welcome."
          value={answer}
          maxLength={ANSWER_MAX}
          disabled={disabled}
          onChange={(e) => setAnswer(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        />
        <p className="text-[11px] text-gray-500">
          {answer.length}/{ANSWER_MAX} — Layla reads this verbatim. Keep it under ~3 sentences and avoid clinical / pricing specifics.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="faq-tags">Tags (optional)</Label>
        <Input
          id="faq-tags"
          placeholder="insurance, financing, carecredit"
          value={tagsRaw}
          disabled={disabled}
          onChange={(e) => setTagsRaw(e.target.value)}
        />
        <p className="text-[11px] text-gray-500">
          Comma-separated aliases that improve fuzzy matching. Up to {TAG_MAX_COUNT}, each {TAG_MAX_LEN} chars max.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        )}
        <Button type="button" onClick={handleSubmit} disabled={disabled}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </div>
  )
}
