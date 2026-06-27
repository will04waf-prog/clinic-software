import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, isDenied, OWNER_ADMIN } from '@/lib/auth/roles'
import { z } from 'zod'

// TCPA: every transactional SMS we send must include a STOP
// instruction. An owner who saves a custom template that omits
// "STOP" (or "opt out" / "unsubscribe") effectively strips that
// disclosure from confirmations and reminders, exposing the clinic
// to carrier filtering and CTIA violations. We refuse such
// templates at save time so the UI can show a clear error rather
// than silently letting renderSmsForConsultation paper over it
// later. Empty string / null are allowed — they fall back to the
// hard-coded DEFAULT_TEMPLATES, which already contain "Reply STOP
// to opt out.".
const STOP_PATTERN = /\b(stop|opt[\s-]?out|unsubscribe)\b/i

const templateField = z.string().max(320).nullable().optional().refine(
  (val) => {
    if (val == null) return true
    const trimmed = val.trim()
    if (trimmed.length === 0) return true
    return STOP_PATTERN.test(trimmed)
  },
  { message: 'Template must include a STOP/opt-out instruction (e.g. "Reply STOP to opt out.") or be left blank to use the default.' },
)

const SmsSettingsSchema = z.object({
  sms_enabled:               z.boolean(),
  sms_confirmation_enabled:  z.boolean(),
  sms_reminder_24h_enabled:  z.boolean(),
  sms_reminder_2h_enabled:   z.boolean(),
  sms_template_confirmation: templateField,
  sms_template_reminder_24h: templateField,
  sms_template_reminder_2h:  templateField,
})

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ADMIN)
  if (isDenied(gate)) return gate.response

  const body = await request.json()
  const parsed = SmsSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Normalize empty strings to null for templates
  const update = {
    ...parsed.data,
    sms_template_confirmation: parsed.data.sms_template_confirmation?.trim() || null,
    sms_template_reminder_24h: parsed.data.sms_template_reminder_24h?.trim() || null,
    sms_template_reminder_2h:  parsed.data.sms_template_reminder_2h?.trim() || null,
  }

  const { error } = await supabase
    .from('organizations')
    .update(update)
    .eq('id', gate.orgId)

  if (error) {
    console.error('[sms-settings] update error:', error)
    return NextResponse.json({ error: 'Failed to save settings.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
