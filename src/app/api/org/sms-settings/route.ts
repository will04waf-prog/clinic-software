import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const SmsSettingsSchema = z.object({
  sms_enabled:               z.boolean(),
  sms_confirmation_enabled:  z.boolean(),
  sms_reminder_24h_enabled:  z.boolean(),
  sms_reminder_2h_enabled:   z.boolean(),
  sms_template_confirmation: z.string().max(320).nullable().optional(),
  sms_template_reminder_24h: z.string().max(320).nullable().optional(),
  sms_template_reminder_2h:  z.string().max(320).nullable().optional(),
})

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

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
    .eq('id', profile.organization_id)

  if (error) {
    console.error('[sms-settings] update error:', error)
    return NextResponse.json({ error: 'Failed to save settings.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
