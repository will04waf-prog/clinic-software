/**
 * /manage/[token] — Phase 4 W5.
 *
 * The public page the patient lands on when they tap the "Manage:
 * <url>" link in their booking-confirmation SMS. Server resolves the
 * token, hydrates the booking, and decides which view to render:
 *   - State "active":   the patient can reschedule or cancel.
 *   - State "canceled": already-canceled marker (idempotent re-visits).
 *   - State "past":     the appointment already happened.
 *   - State "invalid":  token doesn't verify, row missing, etc.
 *
 * State decisions happen server-side so a patient with a tampered
 * link never sees the action UI — they get the friendly "this link
 * can't be used" message and no DB writes are possible from the
 * action endpoints either (they re-verify token + row state).
 *
 * proxy.ts allowlists /manage/* alongside /book — no auth needed.
 */

import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyManageToken } from '@/lib/booking/manage-token'
import { ManageView, type ManageState } from './manage-view'

export const metadata: Metadata = {
  title: 'Manage your appointment',
  description: 'Reschedule or cancel your upcoming visit.',
  // No-index — these URLs contain a capability token. Search engines
  // shouldn't surface them even if they leak into a referrer header.
  robots: { index: false, follow: false },
}

export default async function ManagePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const consultationId = verifyManageToken(token)
  if (!consultationId) {
    return <ManageView state={{ kind: 'invalid' }} />
  }

  // Resolve the booking + its surrounding context. We need the org
  // (name + slug for the slot-availability endpoint), the service
  // (so we know duration + lead_time), the provider (display name).
  // All reads via supabaseAdmin — patient has no session.
  const { data: consultation } = await supabaseAdmin
    .from('consultations')
    .select(`
      id, organization_id, contact_id, provider_id, service_id,
      scheduled_at, duration_min, status,
      organization:organizations(id, name, slug, timezone, booking_enabled),
      service:services(id, name, duration_min, lead_time_hours, booking_horizon_days),
      provider:providers(id, display_name, role_label)
    `)
    .eq('id', consultationId)
    .maybeSingle()

  if (!consultation) {
    return <ManageView state={{ kind: 'invalid' }} />
  }

  const org = Array.isArray(consultation.organization)
    ? consultation.organization[0]
    : consultation.organization
  const service = Array.isArray(consultation.service)
    ? consultation.service[0]
    : consultation.service
  const provider = Array.isArray(consultation.provider)
    ? consultation.provider[0]
    : consultation.provider

  if (!org || !service) {
    return <ManageView state={{ kind: 'invalid' }} />
  }

  if (consultation.status === 'canceled') {
    return <ManageView state={{ kind: 'canceled', orgName: org.name }} />
  }

  const scheduledMs = new Date(consultation.scheduled_at).getTime()
  if (scheduledMs <= Date.now()) {
    return <ManageView state={{ kind: 'past', orgName: org.name }} />
  }

  if (!['scheduled', 'confirmed'].includes(consultation.status)) {
    // hold / completed / no_show / rescheduled — none of which the
    // patient can act on from this page. Surface a soft message.
    return <ManageView state={{ kind: 'invalid' }} />
  }

  const state: ManageState = {
    kind: 'active',
    token,
    orgName:  org.name,
    orgSlug:  org.slug,
    timezone: org.timezone || 'America/New_York',
    service: {
      id: service.id,
      name: service.name,
      durationMin: service.duration_min,
    },
    provider: provider
      ? { id: provider.id, displayName: provider.display_name, roleLabel: provider.role_label ?? null }
      : null,
    scheduledAtUtc: consultation.scheduled_at,
  }
  return <ManageView state={state} />
}
