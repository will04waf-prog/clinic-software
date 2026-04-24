'use client'

/**
 * Bulk Contact Import — 3-step wizard with chunked client-side upload.
 *
 * State machine:
 *   input  → map  → importing → (done | partial-failure)
 *
 * No cross-refresh persistence. If the user closes the tab mid-import,
 * they lose the wizard UI — server-side the contact_imports row and
 * the tagged contacts remain, and undo still works from any future
 * surface that exposes import_id (PR D).
 *
 * Contract with the server (see src/lib/types/import.ts):
 *   - chunk_index 0 creates the contact_imports row and returns its id
 *   - subsequent chunks reference that id
 *   - last chunk (processedSoFar >= total_rows) transitions status to
 *     'completed' and stamps counters
 *   - undo works on 'completed' AND 'processing' imports (PR C relaxed
 *     this — undoing a processing import transitions it to 'undone')
 */

import { useState } from 'react'
import Link from 'next/link'
import {
  Upload,
  FileText,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Undo2,
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  parsePasteText,
  parseCsvFile,
  ParseError,
  MAX_INPUT_BYTES,
} from './_parse'
import { suggestMapping } from './_map'
import type {
  ContactField,
  DupeStrategy,
  ImportChunkRequest,
  ImportChunkResponse,
  ImportRow,
  ImportRowWarning,
} from '@/lib/types/import'

// Must match the server's CHUNK_MAX and TOTAL_MAX in
// src/app/api/contacts/import/route.ts. Duplicated here so the client
// catches over-limit cases before a round-trip rejects them.
const CHUNK_SIZE     = 500
const MAX_TOTAL_ROWS = 5000

type Totals     = { imported: number; updated: number; skipped: number }
type ChunkError = { chunkIndex: number; message: string }
type Step       = 'input' | 'map' | 'importing' | 'done' | 'partial-failure'

const FIELD_LABELS: Record<ContactField, string> = {
  first_name:         'First name',
  last_name:          'Last name',
  email:              'Email',
  phone:              'Phone',
  source:             'Source',
  procedure_interest: 'Procedure interest',
  notes:              'Notes',
  ignore:             '— Ignore column —',
}

const FIELD_OPTIONS: ContactField[] = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'source',
  'procedure_interest',
  'notes',
  'ignore',
]

export default function ImportContactsPage() {
  const [step, setStep] = useState<Step>('input')

  // ── Input step ─────────────────────────────────────────────
  const [pasteText,     setPasteText]     = useState('')
  const [inputError,    setInputError]    = useState<string | null>(null)
  const [inputSource,   setInputSource]   = useState<'paste' | 'csv'>('paste')

  // ── Map step ───────────────────────────────────────────────
  const [headers,       setHeaders]       = useState<string[]>([])
  const [dataRows,      setDataRows]      = useState<string[][]>([])
  const [mapping,       setMapping]       = useState<ContactField[]>([])
  const [dupeStrategy,  setDupeStrategy]  = useState<DupeStrategy>('skip')
  const [mapError,      setMapError]      = useState<string | null>(null)

  // ── Import step ────────────────────────────────────────────
  const [chunks,        setChunks]        = useState<ImportRow[][]>([])
  const [totalRows,     setTotalRows]     = useState(0)
  const [importId,      setImportId]      = useState<string | null>(null)
  // nextUnsent = count of successfully-sent chunks = index of the next
  // chunk to send. If a chunk fails, nextUnsent is NOT advanced, so it
  // equals the failed chunk's index — which is also where retry resumes
  // (see handleRetry: we re-send the failed chunk, relying on the RPC's
  // ON CONFLICT DO NOTHING for idempotency).
  const [nextUnsent,    setNextUnsent]    = useState(0)
  const [totals,        setTotals]        = useState<Totals>({ imported: 0, updated: 0, skipped: 0 })
  const [warnings,      setWarnings]      = useState<ImportRowWarning[]>([])
  const [chunkError,    setChunkError]    = useState<ChunkError | null>(null)

  // ── Undo state (done + partial-failure) ────────────────────
  const [undoing,       setUndoing]       = useState(false)
  const [undoResult,    setUndoResult]    = useState<{ count: number } | null>(null)
  const [undoError,     setUndoError]     = useState<string | null>(null)
  // Local UX hint; server measures the real window from completed_at
  // (done imports) or started_at (processing imports undone mid-flight).
  // This timestamp is captured at first render of the page, so in the
  // partial-failure flow — where a user may sit on the result screen for
  // several minutes before clicking Undo — the local label can drift from
  // the server window by the full session duration. Server is the
  // authority on actual rejection (410 if outside the real window).
  const [undoExpiresAt] = useState(() => Date.now() + 24 * 60 * 60 * 1000)

  // ── Handlers ───────────────────────────────────────────────

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData('text')
    if (new Blob([text]).size > MAX_INPUT_BYTES) {
      e.preventDefault()
      setInputError('Too large — split into smaller imports.')
    } else {
      setInputError(null)
    }
  }

  async function handleParseInput(
    source: 'paste' | 'csv',
    text?:  string,
    file?:  File,
  ) {
    setInputError(null)
    try {
      const parsed = source === 'paste'
        ? parsePasteText(text ?? '')
        : await parseCsvFile(file!)

      if (parsed.rows.length > MAX_TOTAL_ROWS) {
        setInputError(
          `Exceeds ${MAX_TOTAL_ROWS.toLocaleString()} row limit — split into smaller imports.`,
        )
        return
      }

      setHeaders(parsed.headers)
      setDataRows(parsed.rows)
      setMapping(suggestMapping(parsed.headers))
      setInputSource(source)
      setMapError(null)
      setStep('map')
    } catch (err: unknown) {
      if (err instanceof ParseError) setInputError(err.message)
      else                           setInputError((err as Error)?.message ?? 'Failed to parse input.')
    }
  }

  function proceedFromMap() {
    setMapError(null)

    // Hard requirement: at least one column maps to email OR phone —
    // a contact without an identifier isn't useful. First-name missing
    // is NOT blocking; the server stamps 'Unknown' with a warning.
    const hasEmail = mapping.includes('email')
    const hasPhone = mapping.includes('phone')
    if (!hasEmail && !hasPhone) {
      setMapError('Map at least one column to Email or Phone — contacts need an identifier.')
      return
    }

    // Project each source row through the mapping into the wire shape
    // the server expects. Blank cells are dropped (not sent as empty
    // strings) so the server's trim-or-undef logic picks them up as
    // absent, not as present-but-empty.
    const projected: ImportRow[] = dataRows.map((row) => {
      const out: ImportRow = {}
      for (let i = 0; i < mapping.length; i++) {
        const field = mapping[i]
        if (field === 'ignore') continue
        const raw = (row[i] ?? '').trim()
        if (!raw) continue
        if (field === 'procedure_interest') {
          // Split on comma/semicolon so "Botox, Lip Filler" and
          // "Botox; Lip Filler" both become two entries. The server
          // unions these with any existing procedure_interest array
          // on update-strategy imports.
          out.procedure_interest = raw
            .split(/[;,]/)
            .map((p) => p.trim())
            .filter(Boolean)
        } else {
          out[field] = raw
        }
      }
      return out
    })

    const chunked: ImportRow[][] = []
    for (let i = 0; i < projected.length; i += CHUNK_SIZE) {
      chunked.push(projected.slice(i, i + CHUNK_SIZE))
    }

    // Reset all import-step state before kicking off. If the user came
    // here via a prior partial failure + Back + re-edit, we don't want
    // stale totals/warnings bleeding into the new run.
    setChunks(chunked)
    setTotalRows(projected.length)
    setImportId(null)
    setNextUnsent(0)
    setTotals({ imported: 0, updated: 0, skipped: 0 })
    setWarnings([])
    setChunkError(null)
    setUndoResult(null)
    setUndoError(null)
    setStep('importing')

    void sendFromChunk(0, chunked, projected.length, null)
  }

  async function sendFromChunk(
    startIndex: number,
    chunksArg:  ImportRow[][],
    totalArg:   number,
    impIdArg:   string | null,
  ) {
    // Thread importId through the loop as a local rather than relying
    // on React state — setImportId is async from the loop's view, so
    // the next iteration's closure would still see null on chunk 1.
    let currentImportId = impIdArg

    for (let i = startIndex; i < chunksArg.length; i++) {
      const req: ImportChunkRequest = {
        import_id:     i === 0 ? undefined : currentImportId ?? undefined,
        chunk_index:   i,
        total_rows:    totalArg,
        dupe_strategy: dupeStrategy,
        source:        inputSource,
        rows:          chunksArg[i],
      }

      let res: Response
      try {
        res = await fetch('/api/contacts/import', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(req),
        })
      } catch (err: unknown) {
        setChunkError({ chunkIndex: i, message: (err as Error)?.message ?? 'Network error' })
        setStep('partial-failure')
        return
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const message = (body as { error?: string })?.error ?? `HTTP ${res.status}`
        setChunkError({ chunkIndex: i, message })
        setStep('partial-failure')
        return
      }

      const data = (await res.json()) as ImportChunkResponse
      currentImportId = data.import_id
      setImportId(data.import_id)
      setTotals((t) => ({
        imported: t.imported + data.imported,
        updated:  t.updated  + data.updated,
        skipped:  t.skipped  + data.skipped,
      }))
      if (data.warnings.length > 0) {
        setWarnings((ws) => [...ws, ...data.warnings])
      }
      setNextUnsent(i + 1)

      if (data.complete) {
        setStep('done')
        return
      }
    }
  }

  function handleRetry() {
    // Retry re-sends the failed chunk (nextUnsent is its index, since we
    // never advanced past it). Skipping it would leave a silent ~500-row
    // hole in the import that the clinic would have to reconcile by
    // hand — a real UX failure right when their trust is most fragile.
    //
    // Safety: the RPC uses INSERT ... ON CONFLICT DO NOTHING against the
    // (organization_id, lower(email)) partial unique index, so re-sending
    // rows that partially landed on the first attempt is a no-op at the
    // DB level. The cost is one extra RPC round-trip and a duplicate
    // activity_log line per retry — pennies, versus hours of clinic
    // cleanup on a 500-row gap.
    setChunkError(null)
    setStep('importing')
    void sendFromChunk(nextUnsent, chunks, totalRows, importId)
  }

  async function handleUndo() {
    if (!importId || undoing) return
    setUndoing(true)
    setUndoError(null)
    try {
      const res = await fetch('/api/contacts/import/undo', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ import_id: importId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setUndoError((body as { error?: string })?.error ?? `HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { undone_count: number }
      setUndoResult({ count: data.undone_count ?? 0 })
    } catch (err: unknown) {
      setUndoError((err as Error)?.message ?? 'Network error')
    } finally {
      setUndoing(false)
    }
  }

  function resetWizard() {
    setStep('input')
    setPasteText('')
    setInputError(null)
    setInputSource('paste')
    setHeaders([])
    setDataRows([])
    setMapping([])
    setDupeStrategy('skip')
    setMapError(null)
    setChunks([])
    setTotalRows(0)
    setImportId(null)
    setNextUnsent(0)
    setTotals({ imported: 0, updated: 0, skipped: 0 })
    setWarnings([])
    setChunkError(null)
    setUndoResult(null)
    setUndoError(null)
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <>
      <Header
        title="Import Contacts"
        subtitle="Bulk-add leads from a spreadsheet or CSV"
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <StepsIndicator step={step} />

          {step === 'input' && (
            <InputStep
              pasteText={pasteText}
              setPasteText={setPasteText}
              onPaste={handlePaste}
              onPasteSubmit={(text) => handleParseInput('paste', text)}
              onFileSubmit={(file) => handleParseInput('csv', undefined, file)}
              error={inputError}
            />
          )}

          {step === 'map' && (
            <MapStep
              headers={headers}
              sampleRow={dataRows[0] ?? []}
              rowCount={dataRows.length}
              mapping={mapping}
              setMapping={setMapping}
              dupeStrategy={dupeStrategy}
              setDupeStrategy={setDupeStrategy}
              error={mapError}
              onBack={() => setStep('input')}
              onNext={proceedFromMap}
            />
          )}

          {step === 'importing' && (
            <ImportingStep
              chunksDone={nextUnsent}
              totalChunks={chunks.length}
              totals={totals}
              totalRows={totalRows}
            />
          )}

          {(step === 'done' || step === 'partial-failure') && (
            <ResultStep
              step={step}
              totals={totals}
              totalRows={totalRows}
              warnings={warnings}
              chunkError={chunkError}
              // Retry is meaningful whenever there's an unsent chunk —
              // including the failed one (nextUnsent is its index). See
              // handleRetry for the idempotency rationale.
              hasRetry={step === 'partial-failure' && chunks.length > nextUnsent}
              onRetry={handleRetry}
              onUndo={handleUndo}
              undoing={undoing}
              undoResult={undoResult}
              undoError={undoError}
              undoExpiresAt={undoExpiresAt}
              importId={importId}
              onReset={resetWizard}
            />
          )}
        </div>
      </div>
    </>
  )
}

// ── Step indicator ─────────────────────────────────────────

function StepsIndicator({ step }: { step: Step }) {
  const labels: [Step, string][] = [
    ['input',     'Input'],
    ['map',       'Map'],
    ['importing', 'Import'],
  ]
  const activeIndex =
    step === 'input'  ? 0 :
    step === 'map'    ? 1 :
                        2 // importing, done, partial-failure

  return (
    <div className="flex items-center gap-3 text-sm">
      {labels.map(([key, label], i) => (
        <div key={key} className="flex items-center gap-2">
          <div
            className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold ${
              i <= activeIndex ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}
          >
            {i + 1}
          </div>
          <span className={i <= activeIndex ? 'text-gray-900' : 'text-gray-400'}>
            {label}
          </span>
          {i < labels.length - 1 && <span className="text-gray-300">—</span>}
        </div>
      ))}
    </div>
  )
}

// ── Input step ─────────────────────────────────────────────

function InputStep(props: {
  pasteText:     string
  setPasteText:  (v: string) => void
  onPaste:       (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onPasteSubmit: (text: string) => void
  onFileSubmit:  (file: File) => void
  error:         string | null
}) {
  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Paste from a spreadsheet</h2>
        <p className="text-sm text-gray-600 mt-1">
          Copy your rows (with headers) from Excel or Google Sheets and paste below. Or upload a CSV file.
        </p>
      </div>

      <textarea
        value={props.pasteText}
        onChange={(e) => props.setPasteText(e.target.value)}
        onPaste={props.onPaste}
        placeholder={'First Name\tEmail\tPhone\nSarah\tsarah@example.com\t555-0100\n…'}
        className="w-full h-56 rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <div className="flex items-center gap-3">
        <Button
          onClick={() => props.onPasteSubmit(props.pasteText)}
          disabled={!props.pasteText.trim()}
        >
          <FileText className="h-4 w-4" />
          Parse paste
        </Button>

        <span className="text-xs text-gray-400">— or —</span>

        <label className="inline-flex items-center gap-2 cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 active:bg-gray-100 active:scale-[0.98] transition-[background-color,transform] duration-100">
          <Upload className="h-4 w-4" />
          Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) props.onFileSubmit(file)
              e.target.value = '' // allow re-selecting the same file after an error
            }}
          />
        </label>
      </div>

      {props.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{props.error}</span>
        </div>
      )}

      <p className="text-xs text-gray-500">
        Max 10 MB and 5,000 rows per import.
      </p>
    </Card>
  )
}

// ── Map step ───────────────────────────────────────────────

function MapStep(props: {
  headers:         string[]
  sampleRow:       string[]
  rowCount:        number
  mapping:         ContactField[]
  setMapping:      (m: ContactField[]) => void
  dupeStrategy:    DupeStrategy
  setDupeStrategy: (d: DupeStrategy) => void
  error:           string | null
  onBack:          () => void
  onNext:          () => void
}) {
  function setField(idx: number, field: ContactField) {
    const next = props.mapping.slice()
    next[idx] = field
    props.setMapping(next)
  }

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Map columns</h2>
        <p className="text-sm text-gray-600 mt-1">
          {props.rowCount.toLocaleString()} data rows detected. Match each column to a contact field.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
        <div className="grid grid-cols-3 gap-3 px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <div>Your column</div>
          <div>Sample</div>
          <div>Maps to</div>
        </div>
        {props.headers.map((h, i) => (
          <div key={i} className="grid grid-cols-3 gap-3 px-4 py-3 items-center">
            <div className="text-sm font-medium text-gray-900 truncate">
              {h || <span className="text-gray-400 italic">(no header)</span>}
            </div>
            <div className="text-xs text-gray-500 font-mono truncate">
              {props.sampleRow[i] ?? ''}
            </div>
            <select
              value={props.mapping[i] ?? 'ignore'}
              onChange={(e) => setField(i, e.target.value as ContactField)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {FIELD_OPTIONS.map((f) => (
                <option key={f} value={f}>{FIELD_LABELS[f]}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="space-y-2 pt-2">
        <div className="text-sm font-medium text-gray-700">
          If a contact with this email already exists:
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="radio"
              name="dupe"
              checked={props.dupeStrategy === 'skip'}
              onChange={() => props.setDupeStrategy('skip')}
            />
            Skip it
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="radio"
              name="dupe"
              checked={props.dupeStrategy === 'update'}
              onChange={() => props.setDupeStrategy('update')}
            />
            Update empty fields only
          </label>
        </div>
      </div>

      {props.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{props.error}</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={props.onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={props.onNext}>
          Import {props.rowCount.toLocaleString()} rows
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  )
}

// ── Importing step ─────────────────────────────────────────

function ImportingStep(props: {
  chunksDone:  number
  totalChunks: number
  totals:      Totals
  totalRows:   number
}) {
  const pct = props.totalChunks === 0
    ? 0
    : Math.round((props.chunksDone / props.totalChunks) * 100)
  const rowsProcessed = props.totals.imported + props.totals.updated + props.totals.skipped

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
        <h2 className="text-lg font-semibold text-gray-900">Importing…</h2>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full bg-indigo-600 transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{rowsProcessed.toLocaleString()} of {props.totalRows.toLocaleString()} rows</span>
        <span>{props.chunksDone} / {props.totalChunks} chunks</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Imported" value={props.totals.imported} tone="indigo" />
        <Stat label="Updated"  value={props.totals.updated}  tone="blue" />
        <Stat label="Skipped"  value={props.totals.skipped}  tone="gray" />
      </div>
      <p className="text-xs text-gray-500">
        Keep this tab open. If you close it mid-import, the rows that already landed stay — but you&apos;ll lose the progress view and the in-tab undo button.
      </p>
    </Card>
  )
}

// ── Result step (done + partial-failure) ────────────────────

function ResultStep(props: {
  step:          'done' | 'partial-failure'
  totals:        Totals
  totalRows:     number
  warnings:      ImportRowWarning[]
  chunkError:    ChunkError | null
  hasRetry:      boolean
  onRetry:       () => void
  onUndo:        () => void
  undoing:       boolean
  undoResult:    { count: number } | null
  undoError:     string | null
  undoExpiresAt: number
  importId:      string | null
  onReset:       () => void
}) {
  const isPartial = props.step === 'partial-failure'

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start gap-3">
        {isPartial ? (
          <AlertCircle className="h-6 w-6 text-amber-500 flex-shrink-0" />
        ) : (
          <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0" />
        )}
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {isPartial ? 'Import interrupted' : 'Import complete'}
          </h2>
          {isPartial && props.chunkError ? (
            <p className="text-sm text-gray-700 mt-1">
              Chunk {props.chunkError.chunkIndex + 1} failed: {props.chunkError.message}.{' '}
              {props.totals.imported.toLocaleString()} of {props.totalRows.toLocaleString()} rows imported so far.
            </p>
          ) : (
            <p className="text-sm text-gray-700 mt-1">
              {props.totals.imported.toLocaleString()} new, {' '}
              {props.totals.updated.toLocaleString()} updated, {' '}
              {props.totals.skipped.toLocaleString()} skipped.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Imported" value={props.totals.imported} tone="indigo" />
        <Stat label="Updated"  value={props.totals.updated}  tone="blue" />
        <Stat label="Skipped"  value={props.totals.skipped}  tone="gray" />
      </div>

      {props.warnings.length > 0 && <WarningSummary warnings={props.warnings} />}

      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-100">
        {isPartial && props.hasRetry && (
          <Button variant="outline" onClick={props.onRetry}>
            Retry remaining
          </Button>
        )}

        {props.importId && !props.undoResult && (
          <Button variant="outline" onClick={props.onUndo} disabled={props.undoing}>
            <Undo2 className="h-4 w-4" />
            {props.undoing ? 'Undoing…' : 'Undo this import'}
          </Button>
        )}

        <Link
          href="/leads"
          className="text-sm text-indigo-600 hover:underline"
        >
          View your contacts →
        </Link>

        <Button variant="ghost" onClick={props.onReset} className="ml-auto">
          Start another import
        </Button>
      </div>

      {props.importId && !props.undoResult && (
        <p className="text-xs text-gray-500">
          Undo available until {new Date(props.undoExpiresAt).toLocaleString()}.
        </p>
      )}

      {props.undoResult && (
        <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>Undone. {props.undoResult.count.toLocaleString()} contacts removed.</span>
        </div>
      )}

      {props.undoError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>Undo failed: {props.undoError}</span>
        </div>
      )}
    </Card>
  )
}

// ── Small UI helpers ───────────────────────────────────────

type Tone = 'indigo' | 'blue' | 'gray'

const TONE_CLASSES: Record<Tone, string> = {
  indigo: 'bg-indigo-50 text-indigo-700',
  blue:   'bg-blue-50 text-blue-700',
  gray:   'bg-gray-50 text-gray-700',
}

function Stat({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${TONE_CLASSES[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xl font-semibold">{value.toLocaleString()}</div>
    </div>
  )
}

function WarningSummary({ warnings }: { warnings: ImportRowWarning[] }) {
  // Bucket by reason so a 1,000-row import with 400 warnings doesn't
  // dump 400 separate lines at the user. The server's per-row detail
  // lives in activity_log metadata for audit; the UI shows counts.
  const counts = new Map<string, number>()
  for (const w of warnings) counts.set(w.reason, (counts.get(w.reason) ?? 0) + 1)

  const LABEL: Record<string, string> = {
    empty_row:                'Empty rows skipped',
    invalid_email:            'Invalid emails dropped (rows kept, email blanked)',
    invalid_phone:            'Invalid phones dropped (rows kept, phone blanked)',
    missing_first_name:       'First name missing — imported as "Unknown"',
    duplicate_in_paste:       'Duplicate rows within your paste',
    existing_contact_skipped: 'Existing contacts — skipped per your choice',
    silent_dupe_skipped:      'Case-variant duplicates detected at DB (rare)',
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <div className="font-medium text-amber-900 mb-1.5">Notes</div>
      <ul className="text-amber-800 space-y-0.5">
        {Array.from(counts.entries()).map(([reason, count]) => (
          <li key={reason}>
            <span className="font-mono">{count.toLocaleString()}×</span>{' '}
            {LABEL[reason] ?? reason}
          </li>
        ))}
      </ul>
    </div>
  )
}
