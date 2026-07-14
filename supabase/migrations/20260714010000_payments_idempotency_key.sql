-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) then PRODUCTION
-- (rvoxqjpqbchjdizdhajb) 2026-07-14. payments near-empty at apply time.
--
-- Manual (cash/Zelle/check) payment idempotency. Cash/Zelle is the primary
-- collection path for this segment; a double-submit (retry, multi-tab)
-- double-counts and can flip an invoice 'paid' on half the money,
-- corrupting the append-only ledger that feeds dispute evidence. The
-- client mints a stable idempotency key per record-attempt; this partial-
-- unique index makes a duplicate insert with the same key fail (23505),
-- which /api/invoices/[id]/record-payment swallows as already-recorded.
-- Nullable + partial so existing rows and card-payment rows (which have no
-- key) are unaffected.
alter table public.payments add column if not exists idempotency_key uuid;

create unique index if not exists payments_invoice_idemkey_uq
  on public.payments (invoice_id, idempotency_key)
  where idempotency_key is not null;
