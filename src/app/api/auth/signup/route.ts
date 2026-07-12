import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/utils'
import { normalizePhone } from '@/lib/validators'
import { sendWelcomeEmail } from '@/lib/welcome-email'
import type { Vertical } from '@/lib/vertical/config'

// Use the service role key so we can bypass RLS during org creation
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Verticals a self-serve signup may claim. Defaults to landscaping (the
// CRM pivot's first deep-built vertical). Unknown values fall back to it.
const SIGNUP_VERTICALS: Vertical[] = ['landscaping', 'trades', 'food', 'general', 'medspa']

// Error codes the client localizes via the i18n dictionary; `error`
// carries a fallback message for non-localized callers.
function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(req: NextRequest) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('your-project') ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY === 'your-service-role-key'
  ) {
    console.error('[signup] Supabase env vars are missing or still set to placeholders.')
    return fail('server_unconfigured', 'Server is not configured yet.', 503)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('invalid_json', 'Invalid request body.', 400)
  }

  // business_name is the pivot field; clinic_name kept as a legacy alias.
  const businessName: string = (body.business_name ?? body.clinic_name ?? '').trim()
  const fullName: string = (body.full_name ?? '').trim()
  const email: string = (body.email ?? '').trim().toLowerCase()
  const password: string = body.password ?? ''
  const ownerCellRaw: string = (body.owner_cell ?? '').trim()

  const vertical: Vertical = SIGNUP_VERTICALS.includes(body.vertical) ? body.vertical : 'landscaping'
  const ownerLanguage: 'en' | 'es' = body.owner_language === 'en' ? 'en' : 'es'
  // Owner is Spanish-first; customers in this segment often call in
  // English — so the line is bilingual by default. English owners get
  // English-only unless they add Spanish later.
  const callerLanguages = ownerLanguage === 'es' ? ['es', 'en'] : ['en']

  // ── Validation ──────────────────────────────────────────────
  if (!businessName) return fail('business_name', 'Enter your business name.', 400)
  if (!fullName) return fail('owner_name', 'Enter your name.', 400)
  if (!email) return fail('email', 'Enter a valid email.', 400)
  if (!password || password.length < 8) return fail('password', 'Password must be at least 8 characters.', 400)
  // Owner cell is REQUIRED — WhatsApp is the real channel for this segment.
  if (!ownerCellRaw) return fail('phone', 'Enter your cell number.', 400)
  const ownerCell = normalizePhone(ownerCellRaw)
  if (!ownerCell) return fail('phone_format', 'Enter a valid US phone number.', 400)

  // 1. Create auth user (auto-confirmed — zero-friction phone signup)
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) {
    const taken = /already|exists|registered/i.test(authError.message)
    console.error('[signup] Auth user creation failed:', authError.message)
    return fail(taken ? 'email_taken' : 'auth', authError.message, 400)
  }

  const userId = authData.user.id

  try {
    // 2. Create organization with its vertical config.
    const slug = slugify(businessName) + '-' + userId.slice(0, 6)
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    // plan_status='trial' arms the trial banner, reminder emails,
    // expire-trials cron, proxy lockout, and Scale-during-trial rule.
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert({
        name: businessName,
        slug,
        trial_ends_at: trialEndsAt,
        plan: 'trial',
        plan_status: 'trial',
        vertical,
        owner_language: ownerLanguage,
        caller_languages: callerLanguages,
        // WhatsApp-native intent; notify falls back to SMS until
        // WHATSAPP_ENABLED is flipped, so this is safe to set now.
        notification_channel: 'whatsapp',
        owner_notify_e164: ownerCell,
      })
      .select('id')
      .single()

    if (orgError) {
      console.error('[signup] Org creation failed:', orgError.message)
      throw new Error(orgError.message)
    }

    const orgId = org.id

    // 3. Create owner profile
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: userId,
      organization_id: orgId,
      full_name: fullName,
      email,
      role: 'owner',
    })

    if (profileError) {
      console.error('[signup] Profile creation failed:', profileError.message)
      throw new Error(profileError.message)
    }

    // 4. Seed vertical-aware pipeline stages (Spanish for landscaping;
    //    delegates to the legacy English seed for med-spa/others).
    const { error: stagesError } = await supabaseAdmin.rpc('seed_stages_for_vertical', {
      org_id: orgId,
      p_vertical: vertical,
    })

    if (stagesError) {
      console.error('[signup] Stage seeding failed:', stagesError.message)
      throw new Error(stagesError.message)
    }

    // 5. Day-0 welcome email in the owner's language + vertical framing.
    after(async () => {
      try {
        await sendWelcomeEmail({
          orgId,
          orgName: businessName,
          ownerEmail: email,
          ownerFullName: fullName,
          trialEndsAt,
          vertical,
          ownerLanguage,
        })
      } catch (err) {
        console.error('[signup] welcome email failed (non-fatal):', err instanceof Error ? err.message : err)
      }
    })

    return NextResponse.json({ ok: true })
  } catch (innerErr: any) {
    // Roll back the auth user if anything downstream fails.
    console.error('[signup] Rolling back auth user due to error:', innerErr.message)
    await supabaseAdmin.auth.admin.deleteUser(userId)
    return fail('generic', innerErr.message ?? 'Signup failed.', 500)
  }
}
