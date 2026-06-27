/**
 * Resolve the app's public URL once.
 *
 * Background: every voice tool that mints a link (booking, manage,
 * directions, intake) or calls our own /api/booking/* endpoints did
 * `process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'`. If a
 * preview/staging deploy forgot to set the env var, the hardcoded
 * fallback would point staging traffic at prod — meaning a staging
 * Layla would mint prod manage URLs and call prod's /api/booking/hold.
 *
 * Now: in production, throwing on missing env is correct (deploy-
 * time misconfig, fail loud). In dev/test, we keep the localhost
 * fallback so npm run dev still works. Preview/staging callers
 * should set NEXT_PUBLIC_APP_URL to the preview deployment URL.
 */

let warned = false

export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (raw) return raw.replace(/\/$/, '')

  if (process.env.NODE_ENV === 'production') {
    // Throwing here surfaces during the first tool call after deploy,
    // not at module load — but that's the right trade-off: a Vercel
    // build that completes without the env var is the bug, and the
    // tool call's structured error reaches the dashboard.
    throw new Error('NEXT_PUBLIC_APP_URL is required in production')
  }

  if (!warned) {
    console.warn('[app-url] NEXT_PUBLIC_APP_URL is not set; using http://localhost:3000 (dev only).')
    warned = true
  }
  return 'http://localhost:3000'
}
