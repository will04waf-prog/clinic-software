import { NextResponse } from 'next/server'
import { processDueSteps } from '@/lib/automation-engine'
import { sendConsultationReminders } from '@/lib/consultation-reminders'
import { expireTrials } from '@/lib/expire-trials'

// Called by an external cron (e.g. Vercel Cron, GitHub Actions, cron-job.org)
// Protect with a shared secret in the Authorization header.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    await Promise.all([
      processDueSteps(),
      sendConsultationReminders(),
      expireTrials(),
    ])
    return NextResponse.json({ ok: true, ran_at: new Date().toISOString() })
  } catch (err: any) {
    console.error('[cron] error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Allow GET for easy manual triggering during development
export async function GET(request: Request) {
  return POST(request)
}
