'use server'

/**
 * Phase 5 W2 — server action: update clinic street address.
 *
 * The address columns added in 20260710090000_add_org_address.sql
 * feed Layla's give_directions tool. Owners edit them under the new
 * "Clinic address" sub-section in /settings/call-agent.
 *
 * Owner-only (mirrors the page-level guard + the PATCH /api/org/call-
 * agent role gate). We use supabaseAdmin for the actual UPDATE so the
 * write isn't blocked by RLS policies on organizations — the role
 * check above is the authorization boundary.
 *
 * Null vs. empty string: every field on the form is optional. We
 * coerce blank strings to NULL so the column doesn't carry an "" the
 * give_directions tool would have to special-case. country_code is
 * uppercased to keep ISO alpha-2 codes consistent.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const inputSchema = z.object({
  address_line1:    z.string().max(200).nullable(),
  address_line2:    z.string().max(200).nullable(),
  city:             z.string().max(120).nullable(),
  region:           z.string().max(120).nullable(),
  postal_code:      z.string().max(40).nullable(),
  country_code:     z.string().max(2).nullable(),
  google_place_id:  z.string().max(300).nullable(),
  directions_notes: z.string().max(1000).nullable(),
}).strict()

export type ClinicAddressInput = z.infer<typeof inputSchema>

export type ClinicAddressResult =
  | { ok: true }
  | { ok: false; error: string }

function blankToNull(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t.length === 0 ? null : t
}

export async function updateClinicAddress(
  raw: Partial<Record<keyof ClinicAddressInput, string | null>>,
): Promise<ClinicAddressResult> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'Unauthorized' }

  // Owner-only — parallel to the page-level redirect guard.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role, is_active')
    .eq('id', user.id)
    .single()
  if (profileError || !profile)        return { ok: false, error: 'Profile not found' }
  if (profile.is_active === false)     return { ok: false, error: 'Account deactivated' }
  if (profile.role !== 'owner')        return { ok: false, error: 'Only the clinic owner can edit the clinic address.' }
  if (!profile.organization_id)        return { ok: false, error: 'No organization on profile' }

  // Coerce + validate.
  const normalized: ClinicAddressInput = {
    address_line1:    blankToNull(raw.address_line1),
    address_line2:    blankToNull(raw.address_line2),
    city:             blankToNull(raw.city),
    region:           blankToNull(raw.region),
    postal_code:      blankToNull(raw.postal_code),
    country_code:     blankToNull(raw.country_code)?.toUpperCase() ?? null,
    google_place_id:  blankToNull(raw.google_place_id),
    directions_notes: blankToNull(raw.directions_notes),
  }

  const parsed = inputSchema.safeParse(normalized)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { error: updateError } = await supabaseAdmin
    .from('organizations')
    .update(parsed.data)
    .eq('id', profile.organization_id)

  if (updateError) return { ok: false, error: updateError.message }

  revalidatePath('/settings/call-agent')
  return { ok: true }
}
