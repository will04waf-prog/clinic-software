-- TARGET ENV: apply to STAGING (gwccilhrgxuvtmjqojpz) first, then
-- PRODUCTION (rvoxqjpqbchjdizdhajb). Staging-first per the migration rule.
--
-- CRM pivot P3 — card-payment idempotency backstop.
--
-- A client returning to the /pagar/[token] success URL (refresh, double
-- tap, or a re-delivered Checkout completion) must never double-record a
-- card payment. The reconcile path already pre-checks by payment_intent,
-- but a concurrent second load could slip a duplicate past that read.
-- This partial-unique index makes the duplicate INSERT fail at the DB
-- (23505), which reconcileInvoicePayment() swallows and treats as
-- already-recorded.
--
-- Partial (WHERE stripe_payment_intent is not null) so manual cash / Zelle
-- / check rows — which carry no payment_intent — are untouched and may
-- repeat freely (an owner can record two cash part-payments).
--
-- Additive + idempotent (IF NOT EXISTS). No data migration. If any
-- duplicate card rows already existed this would fail to create — verified
-- none do on staging before applying to prod.

create unique index if not exists payments_invoice_intent_uq
  on public.payments (invoice_id, stripe_payment_intent)
  where stripe_payment_intent is not null;
