import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BillingCard } from '@/components/settings/billing-card'
import { ServicesCard } from '@/components/settings/services-card'
import { BookingSettingsLinkCard } from '@/components/settings/booking-settings-link-card'
import { TeamSettingsLinkCard } from '@/components/settings/team-settings-link-card'
import { CallAgentLinkCard } from '@/components/settings/call-agent-link-card'
import { FaqsLinkCard } from '@/components/settings/faqs-link-card'
import { CaptureFormCard } from '@/components/settings/capture-form-card'
import { SmsSettingsCard } from '@/components/settings/sms-settings-card'
import { LanguageNotificationsCard, type CallerLanguage } from '@/components/settings/language-notifications-card'
import { AiTwinSettingsCard } from '@/components/settings/ai-twin-settings-card'
import { AiVoiceTrainingCard } from '@/components/settings/ai-voice-training-card'
import { AiVoiceHealthCard } from '@/components/settings/ai-voice-health-card'
import { AiAutoSendCard } from '@/components/settings/ai-auto-send-card'
import { ChangePasswordCard } from '@/components/settings/change-password-card'
import { SignOutButton } from '@/components/ui/sign-out-button'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select(`
      full_name, email, role,
      organization:organizations(
        name, slug, plan, timezone, plan_status, stripe_customer_id, procedures,
        sms_enabled, sms_confirmation_enabled, sms_reminder_24h_enabled, sms_reminder_2h_enabled,
        sms_template_confirmation, sms_template_reminder_24h, sms_template_reminder_2h,
        ai_twin_enabled, ai_twin_quiet_hours_start, ai_twin_quiet_hours_end,
        caller_languages, owner_language, notification_channel, owner_notify_e164
      )
    `)
    .eq('id', user.id)
    .single()

  const org = profile?.organization as any

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Settings" subtitle="Clinic and account configuration" />

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-2xl">
        <Card>
          <CardHeader><CardTitle>Clinic</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Name</span>
              <span className="font-medium text-gray-900">{org?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Plan</span>
              <span className="font-medium text-gray-900 capitalize">{org?.plan ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Timezone</span>
              <span className="font-medium text-gray-900">{org?.timezone ?? '—'}</span>
            </div>
          </CardContent>
        </Card>

        <BillingCard
          plan={org?.plan ?? 'trial'}
          planStatus={org?.plan_status ?? 'trial'}
          hasStripeCustomer={!!org?.stripe_customer_id}
        />

        {org?.slug && (
          <CaptureFormCard url={`${APP_URL}/capture/${org.slug}`} />
        )}

        <ServicesCard initial={org?.procedures ?? null} />

        {/* Booking calendar — links to /settings/booking. Sits next to
            ServicesCard because the two are conceptually paired: services
            here is the intake-form taxonomy; bookable services + providers
            + availability live on the booking sub-page. */}
        <BookingSettingsLinkCard />

        {/* W8: Team management is owner-only — surface the link card
            only when the current user is the org owner. /settings/team
            also hard-redirects non-owners (defense in depth). */}
        {profile?.role === 'owner' && <TeamSettingsLinkCard />}

        {/* P5 W1: Call agent — owner-only at the link layer; the
            page also handles non-Scale orgs by surfacing
            UpgradeCardLocked, so all roles below owner are hidden
            and non-Scale Scale owners see the upgrade card on click. */}
        {profile?.role === 'owner' && <CallAgentLinkCard />}

        {/* P5 W2: Custom FAQ corpus that backs Layla's lookup_faq
            voice tool. Owner-only at the link layer; the page also
            hard-redirects non-owners. Not tier-gated — the corpus
            can be pre-authored on any plan, but the voice tool that
            reads it only fires when the (Scale-only) call agent is
            on. */}
        {profile?.role === 'owner' && <FaqsLinkCard />}

        {/* Multi-vertical Phase 6: caller languages (drives the Vapi
            assistant's transcriber/voice/bilingual prompt), owner
            language, alert channel + owner mobile. Owner-only — the
            API is OWNER_ONLY and owner_notify_e164 is the owner's
            personal number. Vertical stays admin-set, not shown here. */}
        {profile?.role === 'owner' && (
          <LanguageNotificationsCard initial={{
            caller_languages:     (Array.isArray(org?.caller_languages) && org.caller_languages.length > 0
                                    ? org.caller_languages.filter((l: string): l is CallerLanguage => l === 'en' || l === 'es')
                                    : ['en']) as CallerLanguage[],
            owner_language:       org?.owner_language === 'es' ? 'es' : 'en',
            notification_channel: (['sms', 'whatsapp', 'both'].includes(org?.notification_channel)
                                    ? org.notification_channel : 'sms'),
            owner_notify_e164:    org?.owner_notify_e164 ?? null,
          }} />
        )}

        <SmsSettingsCard initial={{
          sms_enabled:               org?.sms_enabled               ?? false,
          sms_confirmation_enabled:  org?.sms_confirmation_enabled  ?? true,
          sms_reminder_24h_enabled:  org?.sms_reminder_24h_enabled  ?? true,
          sms_reminder_2h_enabled:   org?.sms_reminder_2h_enabled   ?? true,
          sms_template_confirmation: org?.sms_template_confirmation ?? null,
          sms_template_reminder_24h: org?.sms_template_reminder_24h ?? null,
          sms_template_reminder_2h:  org?.sms_template_reminder_2h  ?? null,
        }} />

        {/* AI Twin sits under SMS — it's downstream of SMS being on. */}
        <AiTwinSettingsCard initial={{
          ai_twin_enabled:            org?.ai_twin_enabled            ?? true,
          ai_twin_quiet_hours_start:  org?.ai_twin_quiet_hours_start  ?? null,
          ai_twin_quiet_hours_end:    org?.ai_twin_quiet_hours_end    ?? null,
        }} />

        {/* Voice training (Phase 2 W6). Loads via /api/org/voice-profile
            + /api/org/voice-examples, so no server prefetch needed.
            The anchor is the SetupGuide's "Add voice examples" target. */}
        <div id="ai-twin-training" className="scroll-mt-24">
          <AiVoiceTrainingCard />
        </div>

        {/* Voice training health (Phase 2 W8). Loads via /api/org/voice-health
            — surfaces edit-pattern signals + recommendations. */}
        <AiVoiceHealthCard />

        {/* Autonomous send (Phase 2 W9). Loads via /api/org/auto-send-settings
            — master toggle + per-class allowlist + recent auto-sends. */}
        <AiAutoSendCard />

        <Card>
          <CardHeader><CardTitle>Your Account</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Name</span>
              <span className="font-medium text-gray-900">{profile?.full_name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span className="font-medium text-gray-900">{profile?.email ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Role</span>
              <span className="font-medium text-gray-900 capitalize">{profile?.role ?? '—'}</span>
            </div>
            {profile?.email && <ChangePasswordCard userEmail={profile.email} />}

            <div className="pt-3 border-t border-gray-100">
              <SignOutButton />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
