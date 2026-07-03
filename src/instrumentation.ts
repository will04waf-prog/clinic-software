/**
 * Global server-error monitoring (Next.js instrumentation hook).
 *
 * onRequestError fires for every UNCAUGHT exception in route
 * handlers, server components, and server actions — the errors that
 * previously vanished into Vercel's ephemeral logs until a customer
 * hit them (the number-wizard 401 sat live for weeks that way).
 * Each distinct error signature (message + path) emails the operator
 * at most once per hour via ops-alert's Resend-idempotency throttle.
 *
 * Node runtime only: edge (middleware) errors are skipped — the
 * Resend import chain is Node-specific, and the proxy has its own
 * fail-safe behavior.
 */

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const message = err instanceof Error ? err.message : String(err)
    const errName = err instanceof Error ? err.constructor.name : 'NonError'
    const stackHead = err instanceof Error && err.stack
      ? err.stack.split('\n').slice(0, 6).join('\n')
      : '(no stack)'

    // Throttle key from BOUNDED values only: error class + route
    // pattern. Never the message — V8 parse errors embed request
    // bytes (`Unexpected token 'v', "viagra-spa"...`), so hashing the
    // message would let anyone spamming a public endpoint mint a
    // fresh hourly budget per POST and storm the inbox + the Resend
    // quota the trial-reminder emails ride on. Error classes and the
    // app's route table are both finite, so the worst-case alert
    // volume is bounded. The message still travels in the BODY —
    // a changed body on the same hourly key hits Resend's
    // idempotency conflict and is dropped, which is fine: the first
    // alert of the hour already told the operator where to look.
    const key = `apperr:${errName}:${context.routePath}`

    // Dynamic import: keeps the instrumentation module itself free of
    // Node-only imports at load time (this file is also evaluated in
    // the edge runtime, where the guard above returns first).
    const { alertOperator } = await import('@/lib/ops-alert')
    await alertOperator({
      key,
      subject: `unhandled ${errName}: ${context.routePath}`,
      body: [
        `${request.method} ${request.path} (${context.routeType})`,
        `Error: ${message.slice(0, 500)}`,
        stackHead,
        'Emailed at most once per hour per (error class, route).',
      ].join('\n'),
    })
  } catch (alertErr) {
    console.error('[instrumentation] onRequestError alert failed:', alertErr)
  }
}
