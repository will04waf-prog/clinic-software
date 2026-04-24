/**
 * Paste-text and CSV-file parsers for the bulk-import wizard.
 *
 * Both entry points produce the same shape: `{ headers, rows }` with headers
 * trimmed and rows as raw untrimmed strings (the /api/contacts/import route
 * handles trim + normalize + validate). Rows that are entirely whitespace
 * are dropped at this layer because they're universally junk.
 *
 * Size cap: 10 MB on the raw paste text and on the uploaded file. The
 * server already enforces a 5,000-row total cap, but the browser can lock
 * up parsing tens of MB of garbage before we ever get to chunk it — so we
 * reject oversize payloads up front with a clear message.
 */

import Papa from 'papaparse'

export const MAX_INPUT_BYTES = 10 * 1024 * 1024 // 10 MB

export interface ParsedInput {
  headers: string[]
  rows:    string[][]
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

function byteLength(str: string): number {
  return new Blob([str]).size
}

/**
 * Finalize a PapaParse result into the wizard's ParsedInput shape, or
 * throw a ParseError the UI can display inline. Centralized so paste
 * and file paths apply identical validation (row presence, header row).
 */
function finalizeRows(
  errors: Papa.ParseError[],
  data:   string[][],
): ParsedInput {
  if (errors.length > 0) {
    const first = errors[0]
    // PapaParse sometimes reports errors on malformed quoting but still
    // returns usable data; we treat any error as fatal rather than half-
    // importing with a silent corruption risk.
    throw new ParseError(`Parse error on row ${(first.row ?? 0) + 1}: ${first.message}`)
  }

  const nonEmpty = data.filter((row) =>
    row.some((cell) => typeof cell === 'string' && cell.trim() !== ''),
  )

  if (nonEmpty.length < 2) {
    throw new ParseError('Need a header row plus at least one data row.')
  }

  return {
    headers: nonEmpty[0].map((h) => (h ?? '').trim()),
    rows:    nonEmpty.slice(1),
  }
}

export function parsePasteText(text: string): ParsedInput {
  if (byteLength(text) > MAX_INPUT_BYTES) {
    throw new ParseError('Too large — split into smaller imports.')
  }
  const trimmed = text.trim()
  if (!trimmed) {
    throw new ParseError('Nothing to parse. Paste your data above.')
  }
  // PapaParse auto-detects delimiter (tab for spreadsheet pastes, comma
  // for CSV strings). skipEmptyLines drops blank lines between rows.
  const result = Papa.parse<string[]>(trimmed, { skipEmptyLines: true })
  return finalizeRows(result.errors, result.data as string[][])
}

export function parseCsvFile(file: File): Promise<ParsedInput> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_INPUT_BYTES) {
      reject(new ParseError('Too large — split into smaller imports.'))
      return
    }
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (result) => {
        try {
          resolve(finalizeRows(result.errors, result.data as string[][]))
        } catch (err) {
          reject(err)
        }
      },
      error: (err) => {
        reject(new ParseError(`Failed to read file: ${err.message}`))
      },
    })
  })
}
