/**
 * /aprobar/[token] — CRM-pivot LOOP. PUBLIC client-facing approval page.
 *
 * The customer lands here from the "estimado listo" WhatsApp/SMS link.
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
import { ApprovalBadge } from '@/components/loop/approval-badge'

// Dynamic title/OG so the WhatsApp link preview carries the BUSINESS's
// name — the homeowner's first impression is the chat bubble, and
// "Estimado de Jardinería García" reads like a real company, not a
// mystery link. Still no-index: the URL carries a capability token.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const fallback: Metadata = { title: 'Estimado', robots: { index: false, follow: false } }
  const estimateId = verifyCapabilityToken('estimate_approve', token)
  if (!estimateId) return fallback
  const { data } = await supabaseAdmin
    .from('estimates')
    .select('organization_id, organizations(name)')
    .eq('id', estimateId)
    .maybeSingle()
  const org = (data?.organizations ?? null) as { name?: string } | null
  if (!org?.name) return fallback
  const title = `Estimado de ${org.name}`
  return {
    title,
    description: 'Revise el trabajo y el precio, y apruébelo con un toque.',
    robots: { index: false, follow: false },
    openGraph: { title, description: 'Revise el trabajo y el precio, y apruébelo con un toque.', siteName: org.name },
  }
}

function StatusScreen({
  locale,
  message,
  approvedAt = null,
  clientName = null,
}: {
  locale: Locale
  message: string
  approvedAt?: string | null
  clientName?: string | null
}) {
  const t = dict(locale)
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F5EFE1] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[#0B2027]/10 bg-white p-6 text-center shadow-sm">
        <p className="text-[15px] leading-relaxed text-[#0B2027]">{message}</p>
        {approvedAt && (
          <div className="mt-4 flex justify-center">
            <ApprovalBadge approvedAt={approvedAt} clientName={clientName} locale={locale} variant="muted" />
          </div>
        )}
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
      id, organization_id, status, title, approved_at, created_at, notes,
      subtotal_cents, tax_cents, total_cents, currency, estimate_number,
      line_items:estimate_line_items(id, description, quantity, unit_price_cents, position),
      organization:organizations(name, phone),
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
    return (
      <StatusScreen
        locale={locale}
        message={t.approve.alreadyApproved}
        approvedAt={est.approved_at}
        clientName={contact?.first_name ?? null}
      />
    )
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
      orgPhone={org?.phone ?? null}
      title={est.title ?? ''}
      estimateNumber={est.estimate_number ?? null}
      createdAt={est.created_at ?? null}
      notes={est.notes ?? null}
      lineItems={lineItems}
      subtotalCents={est.subtotal_cents ?? 0}
      taxCents={est.tax_cents ?? 0}
      totalCents={est.total_cents ?? 0}
      currency={est.currency ?? 'usd'}
    />
  )
}
