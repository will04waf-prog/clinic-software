/**
 * /aprobar/[token] — CRM-pivot LOOP. PUBLIC client-facing approval page.
 *
 * The customer lands here from the "presupuesto listo" WhatsApp/SMS link.
 * The server verifies the single-purpose capability token, hydrates the
 * estimate via the SERVICE-ROLE client (the customer has no session; the
 * cookie client would see nothing), and decides what to render:
 *
 *   - invalid token / missing row  → Spanish "no encontrado" (never 500,
 *     never echoes tenant data for a bad token)
 *   - approved                     → "ya aprobado" confirmation
 *   - expired / void               → "no disponible"
 *   - draft / sent / viewed        → the interactive approve view
 *
 * A best-effort viewed_at stamp fires the first time a 'sent' estimate is
 * opened, so the owner can see the client looked before approving.
 *
 * proxy.ts allowlists /aprobar — no session required.
 */
import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCapabilityToken } from '@/lib/tokens/capability-token'
import { dict, resolveLocale, type Locale } from '@/lib/i18n'
import { ApproveView } from './approve-view'

export const metadata: Metadata = {
  title: 'Presupuesto',
  // No-index — the URL carries a capability token. Keep it out of search
  // indexes even if it leaks into a referrer header.
  robots: { index: false, follow: false },
}

function StatusScreen({ locale, message }: { locale: Locale; message: string }) {
  const t = dict(locale)
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F5EFE1] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[#14241d]/10 bg-white p-6 text-center shadow-sm">
        <p className="text-[15px] leading-relaxed text-[#14241d]">{message}</p>
        <p className="mt-5 text-[11px] uppercase tracking-wider text-[#7E8C90]">{t.approve.poweredBy}</p>
      </div>
    </div>
  )
}

export default async function AprobarPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const estimateId = verifyCapabilityToken('estimate_approve', token)
  if (!estimateId) {
    return <StatusScreen locale="es" message={dict('es').approve.notFound} />
  }

  // Service-role read (no client session). Filtering by the token-derived
  // id is the authorization: possession of a valid token IS the grant.
  const { data: est } = await supabaseAdmin
    .from('estimates')
    .select(`
      id, organization_id, status, title,
      subtotal_cents, tax_cents, total_cents, currency, estimate_number,
      line_items:estimate_line_items(id, description, quantity, unit_price_cents, position),
      organization:organizations(name),
      contact:contacts(first_name, preferred_language)
    `)
    .eq('id', estimateId)
    .maybeSingle()

  if (!est) {
    return <StatusScreen locale="es" message={dict('es').approve.notFound} />
  }

  const org = Array.isArray(est.organization) ? est.organization[0] : est.organization
  const contact = Array.isArray(est.contact) ? est.contact[0] : est.contact
  const locale = resolveLocale(contact?.preferred_language)
  const t = dict(locale)
  const orgName = org?.name || 'Tarhunna'

  if (est.status === 'approved') {
    return <StatusScreen locale={locale} message={t.approve.alreadyApproved} />
  }
  if (est.status === 'expired' || est.status === 'void') {
    return <StatusScreen locale={locale} message={t.approve.expired} />
  }
  if (!['draft', 'sent', 'viewed'].includes(est.status)) {
    return <StatusScreen locale={locale} message={t.approve.notFound} />
  }

  // Best-effort viewed stamp: only the sent→viewed edge, guarded so a
  // re-open doesn't overwrite an earlier viewed_at. Failures are ignored.
  if (est.status === 'sent') {
    try {
      await supabaseAdmin
        .from('estimates')
        .update({ status: 'viewed', viewed_at: new Date().toISOString() })
        .eq('id', est.id)
        .eq('status', 'sent')
    } catch { /* non-fatal — the page still renders */ }
  }

  const lineItems = [...(est.line_items ?? [])]
    .sort((a: { position: number | null }, b: { position: number | null }) => (a.position ?? 0) - (b.position ?? 0))
    .map((li: { id: string; description: string; quantity: number | string; unit_price_cents: number }) => ({
      id: li.id,
      description: li.description,
      quantity: Number(li.quantity),
      unitPriceCents: li.unit_price_cents,
    }))

  return (
    <ApproveView
      token={token}
      locale={locale}
      orgName={orgName}
      title={est.title ?? ''}
      lineItems={lineItems}
      subtotalCents={est.subtotal_cents ?? 0}
      taxCents={est.tax_cents ?? 0}
      totalCents={est.total_cents ?? 0}
      currency={est.currency ?? 'usd'}
    />
  )
}
