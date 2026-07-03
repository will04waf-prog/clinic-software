/**
 * GET /api/cron/weekly-digest — Mondays 14:00 UTC (vercel.json).
 *
 * Sends each active org's owner the weekly "Layla's impact" digest.
 * All logic (opt-out column, plan lockout, zero-activity skip, CAS
 * claim, idempotent send) lives in src/lib/weekly-digest.ts; this
 * route is the authenticated cron entry point.
 */

import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron/require-cron-auth'
import { sendWeeklyDigests } from '@/lib/weekly-digest'

export const maxDuration = 300

export async function GET(request: Request) {
  const denied = requireCronAuth(request)
  if (denied) return denied

  const outcome = await sendWeeklyDigests()
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 })
}
