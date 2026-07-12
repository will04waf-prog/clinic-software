/**
 * Stripe Connect Express helpers — server-side only. Owners onboard a
 * connected account so their CLIENTS can pay invoices by card (direct
 * charges on the connected account, with our 1% application fee). Kept
 * thin: the routes own auth + org resolution; this owns the Stripe calls
 * and the single source of truth for how we persist Connect state.
 */
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface ConnectAcctState {
  stripe_connect_id: string | null
  connect_charges_enabled: boolean
  connect_payouts_enabled: boolean
  connect_onboarded_at: string | null
}

/**
 * Ensure the org has a Stripe Express account, creating + persisting one
 * on first call. Returns the account id. Idempotent: a second call with
 * an existing id is a no-op read.
 */
export async function ensureConnectAccount(
  orgId: string,
  owner: { name?: string | null; email?: string | null },
): Promise<string> {
  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('stripe_connect_id')
    .eq('id', orgId)
    .single()
  if (error) throw new Error(`ensureConnectAccount: org lookup failed: ${error.message}`)
  if (org?.stripe_connect_id) return org.stripe_connect_id as string

  const account = await stripe.accounts.create({
    type: 'express',
    country: 'US',
    email: owner.email ?? undefined,
    business_type: 'individual',
    business_profile: {
      name: owner.name ?? undefined,
      // MCC 0780 = landscaping / horticultural services.
      mcc: '0780',
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { organization_id: orgId },
  })

  const { error: upErr } = await supabaseAdmin
    .from('organizations')
    .update({ stripe_connect_id: account.id, updated_at: new Date().toISOString() })
    .eq('id', orgId)
  if (upErr) throw new Error(`ensureConnectAccount: could not persist account id: ${upErr.message}`)

  return account.id
}

/** Mint a fresh onboarding link. Both URLs live under our own origin. */
export async function createOnboardingLink(accountId: string, origin: string): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: accountId,
    // An expired/abandoned link bounces here; the GET route re-mints one.
    refresh_url: `${origin}/api/connect/onboard`,
    return_url: `${origin}/api/connect/return`,
    type: 'account_onboarding',
  })
  return link.url
}

/**
 * Retrieve the live account and persist charges/payouts flags. Stamps
 * connect_onboarded_at the first time charges go live (never clears it).
 * Returns the fresh flags so a caller can branch on them.
 */
export async function syncConnectStatus(
  orgId: string,
  accountId: string,
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean }> {
  const acct = await stripe.accounts.retrieve(accountId)
  const chargesEnabled = acct.charges_enabled === true
  const payoutsEnabled = acct.payouts_enabled === true

  const update: Record<string, unknown> = {
    connect_charges_enabled: chargesEnabled,
    connect_payouts_enabled: payoutsEnabled,
    updated_at: new Date().toISOString(),
  }
  if (chargesEnabled) {
    // Stamp once, on the first time charges are live. A later retrieve
    // must not overwrite the original onboarding timestamp, so only set
    // it when it isn't already set.
    const { data: cur } = await supabaseAdmin
      .from('organizations')
      .select('connect_onboarded_at')
      .eq('id', orgId)
      .single()
    if (!cur?.connect_onboarded_at) update.connect_onboarded_at = new Date().toISOString()
  }

  const { error } = await supabaseAdmin.from('organizations').update(update).eq('id', orgId)
  if (error) throw new Error(`syncConnectStatus: persist failed: ${error.message}`)

  return { chargesEnabled, payoutsEnabled }
}
