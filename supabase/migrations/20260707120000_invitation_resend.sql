-- Phase 4 W9 — track invitation resends.
--
-- Owner can re-send the original invitation email (same token, same
-- accept-invite link) when the invitee misplaced it. Stored fields:
--   resend_count   — incremented on each resend; powers the Resend
--                    idempotency key suffix so Resend's 24h dedupe
--                    doesn't swallow a legitimate re-send.
--   last_resent_at — for the UI (show "Re-sent 5m ago").
--
-- expires_at gets extended (+7d) by the resend route, not by this
-- migration — the column already has its default from W8.

alter table public.team_invitations
  add column if not exists resend_count   integer     not null default 0,
  add column if not exists last_resent_at timestamptz;

comment on column public.team_invitations.resend_count is
  'W9: counts manual resends. Powers idempotency key suffix so Resend re-sends a fresh email instead of dedupe-swallowing.';
