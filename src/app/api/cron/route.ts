import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron/require-cron-auth'
import { alertOperator } from '@/lib/ops-alert'
import { processDueSteps } from '@/lib/automation-engine'
import { sendConsultationReminders } from '@/lib/consultation-reminders'
import { expireTrials } from '@/lib/expire-trials'
import { sendTrialReminders } from '@/lib/trial-reminders'
import { processEnrollmentJobs } from '@/lib/enrollment-jobs'
import { expireDrafts } from '@/lib/expire-drafts'
import { expireBookingHolds } from '@/lib/booking/expire-holds'
import { expireInvitations } from '@/lib/expire-invitations'

// Called by an external cron (e.g. Vercel Cron, GitHub Actions, cron-job.org)
// Protect with a shared secret in the Authorization header.
export async function POST(request: Request) {
  const denied = requireCronAuth(request)
  if (denied) return denied

  const jobNames = [
    'process_due_steps',
    'consultation_reminders',
    'expire_trials',
    'trial_reminders',
    'enrollment_jobs',
    'expire_drafts',
    'expire_holds',
    'expire_invitations',
  ] as const

  const settled = await Promise.allSettled([
    processDueSteps(),
    sendConsultationReminders(),
    expireTrials(),
    sendTrialReminders(),
    processEnrollmentJobs(),
    expireDrafts(),
    expireBookingHolds(),
    expireInvitations(),
  ])

  const jobs: Record<string, unknown> = {}
  const failures: { name: string; message: string }[] = []
  settled.forEach((res, i) => {
    const name = jobNames[i]
    if (res.status === 'fulfilled') {
      jobs[name] = res.value
    } else {
      const message = res.reason instanceof Error ? res.reason.message : String(res.reason)
      console.error(`[cron] job ${name} failed:`, message)
      jobs[name] = { error: message }
      failures.push({ name, message })
    }
  })

  // Nothing fails silently: any thrown job pages the operator and the
  // run reports 500 so the Vercel cron dashboard shows red instead of
  // a green lie. FIXED key — one alert per hour TOTAL, whatever the
  // failing set is. (Keying per failing-set multiplies the budget when
  // the set flaps: a degraded DB failing random subsets each minute
  // would mint a fresh key most ticks → the 60-emails/hour storm the
  // throttle exists to prevent. A set change mid-hour just hits
  // Resend's idempotency conflict and is dropped — next hour's email
  // carries the current set.)
  if (failures.length > 0) {
    await alertOperator({
      key: 'cron-main',
      subject: `main cron: ${failures.length} job${failures.length === 1 ? '' : 's'} failing`,
      body: failures.map((f) => `${f.name}: ${f.message}`).join('\n')
        + '\nRuns every minute — this alert repeats at most hourly while failures persist.',
    })
  }

  const enrollmentSlot = settled[4]
  const draftsSlot = settled[5]
  const holdsSlot = settled[6]
  const invitesSlot = settled[7]

  const enrollmentResult = enrollmentSlot.status === 'fulfilled' ? enrollmentSlot.value : null
  const draftsResult = draftsSlot.status === 'fulfilled' ? draftsSlot.value : null
  const holdsResult = holdsSlot.status === 'fulfilled' ? holdsSlot.value : null
  const invitesResult = invitesSlot.status === 'fulfilled' ? invitesSlot.value : null

  return NextResponse.json({
    ok: failures.length === 0,
    ran_at: new Date().toISOString(),
    enrollment_jobs: enrollmentResult,
    drafts_expired: draftsResult?.expired ?? null,
    holds_expired: holdsResult?.expired ?? null,
    invitations_expired: invitesResult?.expired ?? null,
    invitations_error: invitesResult?.error,
    jobs,
  }, { status: failures.length === 0 ? 200 : 500 })
}

// Allow GET for easy manual triggering during development
export async function GET(request: Request) {
  return POST(request)
}
