-- Per-tenant kill switch for CLIENT-facing messaging (WhatsApp + SMS).
-- Shared-sender insurance: one misbehaving tenant must be cuttable in
-- seconds without touching the platform number. Owner-bound alerts are
-- deliberately NOT gated — the tenant still hears from us.
-- Applied: staging 2026-07-21, prod 2026-07-21.
alter table organizations
  add column if not exists client_messaging_blocked_at timestamptz default null,
  add column if not exists client_messaging_blocked_reason text default null;

comment on column organizations.client_messaging_blocked_at is
  'When set, all client-facing sends (notifyClient, WA inbox composer, review flows) no-op. Super-admin only.';
