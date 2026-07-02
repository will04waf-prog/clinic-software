import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron/require-cron-auth'
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
  settled.forEach((res, i) => {
    const name = jobNames[i]
    if (res.status === 'fulfilled') {
      jobs[name] = res.value
    } else {
      const message = res.reason instanceof Error ? res.reason.message : String(res.reason)
      console.error(`[cron] job ${name} failed:`, message)
      jobs[name] = { error: message }
    }
  })

  const enrollmentSlot = settled[4]
  const draftsSlot = settled[5]
  const holdsSlot = settled[6]
  const invitesSlot = settled[7]

  const enrollmentResult = enrollmentSlot.status === 'fulfilled' ? enrollmentSlot.value : null
  const draftsResult = draftsSlot.status === 'fulfilled' ? draftsSlot.value : null
  const holdsResult = holdsSlot.status === 'fulfilled' ? holdsSlot.value : null
  const invitesResult = invitesSlot.status === 'fulfilled' ? invitesSlot.value : null

  return NextResponse.json({
    ok: true,
    ran_at: new Date().toISOString(),
    enrollment_jobs: enrollmentResult,
    drafts_expired: draftsResult?.expired ?? null,
    holds_expired: holdsResult?.expired ?? null,
    invitations_expired: invitesResult?.expired ?? null,
    invitations_error: invitesResult?.error,
    jobs,
  })
}

// Allow GET for easy manual triggering during development
export async function GET(request: Request) {
  return POST(request)
}
