/**
 * Create (or find) the CRM SaaS Price: Tarhunna, $39/mo recurring, USD.
 *
 * Idempotent via a stable lookup_key ('crm_monthly_v1') — re-running finds
 * the existing Price instead of minting a duplicate. Prints the Price id
 * and the exact .env line to set (STRIPE_PRICE_CRM_MONTHLY).
 *
 * Run (test mode) once the real sk_test key is in .env.local:
 *   npx tsx scripts/create-crm-price.ts
 *
 * Numbers are read from the single source of truth (connect-fees.ts) so
 * they can never drift from the app.
 */
import Stripe from 'stripe'
import { CRM_PLAN } from '../src/lib/billing/connect-fees'

const LOOKUP_KEY = 'crm_monthly_v1'

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || key.includes('your') || key.endsWith('_key')) {
    throw new Error('STRIPE_SECRET_KEY is missing or still the placeholder — set a real sk_test key in .env.local first.')
  }
  const stripe = new Stripe(key, { apiVersion: '2026-03-25.dahlia' })

  const mode = key.startsWith('sk_live') ? 'LIVE' : 'TEST'
  console.log(`Stripe mode: ${mode}`)

  // Already exists? (idempotent)
  const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 })
  if (existing.data[0]) {
    const p = existing.data[0]
    console.log(`Found existing Price: ${p.id} (${(p.unit_amount ?? 0) / 100}/${p.recurring?.interval})`)
    console.log(`\nSTRIPE_PRICE_CRM_MONTHLY=${p.id}`)
    return
  }

  // Find or create the product.
  const products = await stripe.products.search({ query: `name:'${CRM_PLAN.name}' AND active:'true'`, limit: 1 })
  const product =
    products.data[0] ??
    (await stripe.products.create({
      name: CRM_PLAN.name,
      description: 'Tarhunna — CRM en español para negocios de servicios. Plan mensual.',
    }))
  console.log(`Product: ${product.id} (${product.name})`)

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: CRM_PLAN.monthlyPriceCents,
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: LOOKUP_KEY,
    nickname: 'CRM Monthly ($39)',
  })

  console.log(`Created Price: ${price.id} — $${(price.unit_amount ?? 0) / 100}/${price.recurring?.interval}`)
  console.log(`\nSet this in .env.local (and later Vercel prod):`)
  console.log(`STRIPE_PRICE_CRM_MONTHLY=${price.id}`)
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err)
  process.exit(1)
})
