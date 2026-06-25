-- ============================================================
-- Phase 4 W2 — Public booking page.
--
-- Adds the master toggle that lets a clinic turn off public booking
-- without dropping a tier or deleting data. Defaults to true so
-- existing orgs that already set up providers/services in W1 are
-- immediately bookable once the public page ships.
--
-- We do NOT add anon-readable RLS policies on providers/services/
-- availability_*. Instead, the public API routes use the service-
-- role client and validate the org slug + the booking_enabled flag
-- before reading. Reasons:
--   1. Anonymous select would expose every clinic's full schedule
--      to anyone, even orgs that haven't turned booking on.
--   2. The API layer lets us filter by is_active + is_bookable_online
--      + booking_enabled in one place — RLS expressions can't easily
--      enforce the cross-table booking_enabled check.
--   3. Service-role calls are already cheap and scoped per-request,
--      so we don't gain anything from per-row RLS for this read path.
--
-- Single statement, no DO blocks needed.
-- ============================================================

alter table public.organizations add column if not exists booking_enabled boolean not null default true;

comment on column public.organizations.booking_enabled is
  'W2: master kill switch for the public /book/[slug] page. When false, the page renders an "Online booking is paused" message and /api/booking/public/* + /api/booking/hold + /api/booking/confirm return 403. Default true.';
