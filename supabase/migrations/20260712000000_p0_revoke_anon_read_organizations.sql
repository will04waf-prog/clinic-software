-- TARGET ENV: PRODUCTION (project rvoxqjpqbchjdizdhajb — the live app DB).
-- Applied to prod 2026-07-12 via apply_migration.
--
-- P0 security fix: remove unauthenticated read access to public.organizations.
--
-- The anon_read_for_capture policy (USING true, role anon) let anyone
-- holding the browser-shipped NEXT_PUBLIC_SUPABASE_ANON_KEY run
-- GET /rest/v1/organizations?select=* and read every column of every
-- tenant row — Stripe customer/subscription IDs, owner_notify_e164,
-- twilio_phone_number/sid, a2p brand data, business hours, faqs.
--
-- The only consumer, the capture GET route (src/app/api/capture/[slug]/route.ts),
-- now reads via the service-role client with a fixed 4-column allowlist
-- (id,name,slug,procedures), so anon needs no access to this table.
-- The org_isolation policy (id = current_org_id()) continues to scope
-- authenticated users to their own org and denies anon on its own
-- (current_org_id() is null without a JWT org claim). Revoking the
-- blanket anon grants is defense-in-depth so no future permissive policy
-- can silently re-open the leak.

drop policy if exists anon_read_for_capture on public.organizations;
revoke all on public.organizations from anon;
