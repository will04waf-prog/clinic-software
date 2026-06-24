-- ============================================================
-- AI Front-Desk Twin — Phase 2 Week 6
--
-- Per-org voice training surface. Two pieces:
--
-- 1. Voice profile lives on organizations.ai_twin_voice_profile
--    (jsonb column already exists, default '{}' from Phase 1 W4).
--    The shape stored there is:
--      {
--        "tone_formal":   number 0-100,   -- 0=casual, 100=formal
--        "tone_warm":     number 0-100,   -- 0=warm, 100=clinical
--        "banned_phrases": string[],
--        "custom_signoff": string | null
--      }
--    No schema-level enforcement — we validate on the API layer.
--    Storing as jsonb (not discrete columns) keeps Phase 2 W7+W8
--    free to extend the shape without per-field migrations.
--
-- 2. Example messages live in a dedicated table so we can:
--    - Tag each example with a message-class label (greeting,
--      faq, follow_up, consult_confirm, follow_up_cold, custom)
--    - Use them as few-shot prompts in W7 (the SQL query is then
--      cheap: "give me 3 examples matching class=X for this org")
--    - Track edit history per example without rewriting the
--      whole voice_profile blob.
--
-- Org-isolated via RLS. Soft cap of ~30 examples per org enforced
-- by the API (not DB) — gives headroom for class diversity without
-- bloating few-shot prompts later.
-- ============================================================

create table public.voice_examples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  -- What kind of message this is. Few-shot retrieval in W7 will
  -- match on this so a "faq" inbound gets faq examples, etc. The
  -- 'custom' bucket is for examples that don't fit a known class.
  class text not null
    check (class in ('greeting', 'faq', 'follow_up', 'consult_confirm', 'follow_up_cold', 'custom')),

  -- A short label the user sees in the Settings list — "Lip filler
  -- price ask", "Friday follow-up". Optional, falls back to a
  -- truncation of the body in the UI.
  label text,

  -- The example body itself. This is what the staff member would
  -- type. Length-capped to keep few-shot prompts bounded.
  body text not null check (length(body) > 0 and length(body) <= 600),

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hot read path: "give me the voice examples for this org, optionally
-- filtered by class." Few-shot retrieval in W7 will use both shapes.
create index voice_examples_org_class_idx
  on public.voice_examples (organization_id, class, created_at desc);

-- updated_at maintenance — same pattern as other tables in this repo.
create or replace function public.touch_voice_examples_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger voice_examples_touch_updated_at
  before update on public.voice_examples
  for each row execute function public.touch_voice_examples_updated_at();

-- ────────────────────────────────────────────────────────────
-- RLS — org isolation, same shape as messages/ai_drafts
-- ────────────────────────────────────────────────────────────

alter table public.voice_examples enable row level security;

create policy voice_examples_org_isolation on public.voice_examples
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

grant select, insert, update, delete on public.voice_examples
  to authenticated, service_role;

comment on table public.voice_examples is
  'AI Twin voice training: example messages the clinic provides so future drafts can match their voice via few-shot prompting. Phase 2 W6 collects them; W7 uses them.';
