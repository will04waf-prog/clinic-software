-- ============================================================
-- Phase 5 W2 — voice_messages: caller-dictated messages collected
-- during a Layla call.
--
-- When Layla can't fully resolve a caller's request (or the caller
-- explicitly asks to leave a message for the owner), she invokes
-- the take_message tool which writes a row here and fires a PHI-
-- free owner notification email.
--
-- PHI policy:
--   - message_text + caller_name + caller_phone are stored verbatim
--     on this row and are ONLY ever surfaced in-app (owner inbox).
--   - The owner notification email contains no PHI — just a deep
--     link instructing the owner to open ClinIQ to read the message.
--
-- Identity:
--   - caller_phone is captured from the Twilio envelope (tc.fromE164),
--     never from an LLM argument — see the route handler.
--   - contact_id is best-effort: populated when the caller ID maps
--     to a known contact via the standard last-10-digit ilike lookup.
--     A missing contact_id is normal (unknown caller, new lead).
--
-- Dedupe:
--   - The owner-email-notification flow keys idempotency on the row
--     id itself (`voice_message_notify:${id}`) so each distinct
--     message fires exactly one email, even if a caller leaves
--     several messages in one call or across calls.
--
-- ============================================================

create table public.voice_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  contact_id uuid
    references public.contacts(id) on delete set null,

  -- Caller-supplied (LLM-collected) display name. Length-capped to
  -- keep the inbox readable.
  caller_name text not null check (length(caller_name) > 0 and length(caller_name) <= 120),

  -- E.164 caller id from the Twilio envelope. Nullable because some
  -- inbound calls present no caller id at all.
  caller_phone text,

  -- The dictated message body. Length-capped to keep storage + UI
  -- bounded; matches the input cap enforced at the route layer.
  message_text text not null check (length(message_text) > 0 and length(message_text) <= 2000),

  -- Closed enums — validated again at the route layer for defense in
  -- depth, but the DB is the durable contract for the inbox UI.
  urgency text not null default 'normal'
    check (urgency in ('normal', 'urgent')),
  callback_preference text not null default 'either'
    check (callback_preference in ('call', 'text', 'either')),

  -- Vapi call sid, when present — lets the owner correlate the
  -- message back to the call recording / transcript.
  call_sid text,

  -- Owner inbox status. New rows start 'open'; owner can mark
  -- 'resolved' once they've followed up.
  status text not null default 'open'
    check (status in ('open', 'resolved')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hot read path: "show me the open messages for this org, newest
-- first." Inbox UI will use this shape.
create index voice_messages_org_created_idx
  on public.voice_messages (organization_id, created_at desc);

create index voice_messages_org_status_idx
  on public.voice_messages (organization_id, status, created_at desc);

create or replace function public.touch_voice_messages_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger voice_messages_touch_updated_at
  before update on public.voice_messages
  for each row execute function public.touch_voice_messages_updated_at();

-- ────────────────────────────────────────────────────────────
-- RLS — org isolation, same shape as voice_examples / messages.
-- The Vapi tool route writes via supabaseAdmin (service role) and
-- therefore bypasses RLS; this policy governs in-app (owner inbox)
-- reads + status updates.
-- ────────────────────────────────────────────────────────────

alter table public.voice_messages enable row level security;

create policy voice_messages_org_isolation on public.voice_messages
  for all
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  )
  with check (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

grant select, insert, update, delete on public.voice_messages
  to authenticated, service_role;

comment on table public.voice_messages is
  'Phase 5 W2: caller-dictated messages collected by the Layla voice agent via the take_message tool. PHI lives here and in the in-app inbox only — never in the owner notification email body.';
