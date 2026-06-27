-- Phase 5 W2 hardening — tighten RLS on voice_messages.
--
-- The original policy (20260710120000_add_voice_messages.sql lines
-- 101-112) only checked organization_id match, which let any active
-- OR DEACTIVATED profile in the org SELECT voicemail PHI. Two gaps:
--
--   1. profiles.is_active=false rows (former staff, paused seats)
--      still got read access — they should be locked out the moment
--      they're deactivated.
--   2. Any role could read PHI — voicemails are an owner-only inbox
--      per the route handler's check, but the RLS policy didn't
--      mirror that, so a direct Supabase client query from a non-
--      owner profile would return rows.
--
-- New policy: owner role only, and only when the profile is_active.
-- Matches the convention from call_logs + voice-messages server
-- actions.

drop policy if exists voice_messages_org_isolation on public.voice_messages;

create policy voice_messages_owner_only on public.voice_messages
  for all
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid()
        and role = 'owner'
        and is_active = true
    )
  )
  with check (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid()
        and role = 'owner'
        and is_active = true
    )
  );

comment on policy voice_messages_owner_only on public.voice_messages is
  'Phase 5 W2 hardening: owner role only + must be active. Replaces the looser org-isolation policy.';
