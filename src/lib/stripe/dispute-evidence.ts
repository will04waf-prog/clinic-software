/**
 * Dispute-evidence rider — pure builder, no I/O.
 *
 * When a client disputes a card charge, our strongest (usually only)
 * evidence is the loop's own paper trail: the client APPROVED the
 * estimate via a signed single-purpose link, and we recorded when
 * (approved_at) and from where (approved_ip). This composes that record
 * into Stripe's dispute-evidence shape.
 *
 * Direct-charge model: the dispute lives on the connected account, so
 * the caller submits this via `stripe.disputes.update(..., { stripeAccount })`.
 * Kept pure so the composition is unit-testable without Stripe.
 */
import type Stripe from 'stripe'

export interface DisputeEvidenceInput {
  businessName: string
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  invoiceNumber: number
  invoiceTitle?: string | null
  totalCents: number
  /** From the approved estimate, when the invoice came from one. */
  estimateNumber?: number | null
  approvedAt?: string | null // ISO timestamptz
  approvedIp?: string | null
  /** jobs.scheduled_date (YYYY-MM-DD) when a job exists. */
  serviceDate?: string | null
  /**
   * Stripe File id (from stripe.files.create with purpose
   * 'dispute_evidence') of a COMPLETION PHOTO of the job. The Connect
   * webhook uploads the job_photos image to Stripe and passes the id here;
   * it becomes the `service_documentation` evidence — indisputable proof
   * the work was performed. Optional (not every invoice has a photo).
   */
  serviceDocFileId?: string | null
  /** How many completion photos exist (for the narrative). */
  photoCount?: number
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** '2026-07-12T18:03:21.000Z' → '2026-07-12 18:03 UTC' (falls back to raw). */
function humanUtc(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]} UTC` : iso
}

export function buildDisputeEvidence(i: DisputeEvidenceInput): Stripe.DisputeUpdateParams.Evidence {
  const hasApproval = !!i.approvedAt

  const lines: string[] = []
  if (hasApproval) {
    const est = i.estimateNumber ? `Estimate #${i.estimateNumber}` : 'the estimate for this work'
    const ip = i.approvedIp ? ` from IP address ${i.approvedIp}` : ''
    const phone = i.customerPhone ? ` delivered to the customer's phone ${i.customerPhone}` : ''
    lines.push(
      `The customer digitally approved ${est} on ${humanUtc(i.approvedAt!)}${ip}, via a single-use signed approval link${phone}. ` +
      `The approval timestamp and IP address were recorded at the moment of acceptance.`,
    )
  }
  lines.push(
    `Invoice #${i.invoiceNumber}${i.invoiceTitle ? ` ("${i.invoiceTitle}")` : ''} for ${money(i.totalCents)} was issued by ${i.businessName}` +
    `${hasApproval ? ' for the approved work' : ''} and paid by card by the customer.`,
  )
  if (i.serviceDate) {
    lines.push(`The work was scheduled for ${i.serviceDate}.`)
  }
  if (i.photoCount && i.photoCount > 0) {
    lines.push(
      `The business documented the completed work with ${i.photoCount} ` +
      `photo${i.photoCount === 1 ? '' : 's'} taken on site${i.serviceDocFileId ? ' (attached)' : ''}.`,
    )
  }

  return {
    ...(i.customerName ? { customer_name: i.customerName } : {}),
    ...(i.customerEmail ? { customer_email_address: i.customerEmail } : {}),
    ...(i.approvedIp ? { customer_purchase_ip: i.approvedIp } : {}),
    ...(i.serviceDate ? { service_date: i.serviceDate } : {}),
    // Completion photo as proof-of-service (a Stripe File id).
    ...(i.serviceDocFileId ? { service_documentation: i.serviceDocFileId } : {}),
    product_description: `Landscaping services — Invoice #${i.invoiceNumber}${i.invoiceTitle ? ` ("${i.invoiceTitle}")` : ''}`,
    uncategorized_text: lines.join(' '),
  }
}
