-- Phase 4 W8 follow-up — owner-only RLS on team_invitations.
--
-- The W8 review flagged that the org_isolation policy lets ANY org
-- member read pending invitations (including invitee emails). That's
-- a small privacy leak — staff can see who the owner is recruiting
-- before they accept. The API enforces owner-only at the route
-- layer, but RLS should match the same envelope as defense in depth.
--
-- Replace the single all-verbs policy with explicit per-verb gates
-- so RLS doesn't allow what the route does not.

do $w8_inv_rls_tighten$
begin
  drop policy if exists team_invitations_org_isolation on public.team_invitations;
end
$w8_inv_rls_tighten$;

do $w8_inv_rls_owner_read$
begin
  drop policy if exists team_invitations_owner_select on public.team_invitations;
  create policy team_invitations_owner_select
    on public.team_invitations
    for select
    using (
      organization_id in (
        select organization_id from public.profiles
        where id = auth.uid()
          and role = 'owner'
          and is_active = true
      )
    );
end
$w8_inv_rls_owner_read$;

-- Mutations all happen via service-role from the API after a
-- requireRole gate, so we don't add per-verb policies for
-- INSERT/UPDATE/DELETE; absence-of-policy means no access for
-- anon/authenticated, which is exactly what we want.

comment on policy team_invitations_owner_select on public.team_invitations is
  'W8: pending-invite reads are limited to active owners. API routes also enforce this at the layer above; RLS is defense in depth.';
