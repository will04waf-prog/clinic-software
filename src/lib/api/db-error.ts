import { NextResponse } from 'next/server'

/**
 * Return a SAFE error response for an internal/DB failure. The raw
 * Postgres/constraint/RLS text is logged server-side (with a route tag)
 * and NEVER sent to the caller — leaking it exposes schema internals and
 * shows a Spanish-first owner an English DB error. Zod validation messages
 * are intentionally user-facing and are NOT routed through this.
 *
 * The default public message is Spanish (the go-forward product's
 * language); pass `publicMessage` for an English (legacy) surface.
 */
export function dbErrorResponse(
  tag: string,
  error: unknown,
  opts?: { status?: number; publicMessage?: string },
): NextResponse {
  const detail = error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error)
  console.error(`[${tag}]`, detail)
  return NextResponse.json(
    { error: opts?.publicMessage ?? 'No se pudo completar la operación. Intente de nuevo.' },
    { status: opts?.status ?? 500 },
  )
}
