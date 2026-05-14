-- ============================================================
-- Add opted_out_at audit timestamp + RPC for Twilio inbound webhook.
-- ============================================================

-- Audit-trail timestamp for SMS opt-out events.
-- Invariant: opted_out_at IS NOT NULL iff opted_out_sms = true.
alter table public.contacts
  add column if not exists opted_out_at timestamptz;

-- Backfill: rows currently opted out get an anchor timestamp.
-- We can't know the real historical opt-out moment for pre-existing rows;
-- using now() is the simplest "unknown — anchoring to migration time" marker.
update public.contacts
  set opted_out_at = now()
  where opted_out_sms = true
    and opted_out_at is null;

-- ------------------------------------------------------------
-- RPC: set_sms_opt_out_by_phone_suffix
-- Called by /api/webhooks/twilio/inbound after signature verification.
-- Matches contacts whose phone column ends in the given 10 digits
-- (after stripping non-digit characters). Idempotent — only updates
-- rows whose state would actually change, so Twilio retry storms
-- are safe.
--
-- Future optimization: contacts.phone is not consistently normalized
-- (capture-form rows store raw user input, bulk-import rows store E.164).
-- A separate normalized indexed column (e.g. phone_normalized text)
-- would replace this regexp_replace scan with an index lookup at scale.
-- ------------------------------------------------------------
create or replace function public.set_sms_opt_out_by_phone_suffix(
  p_phone_suffix text,
  p_opt_out      boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_affected integer;
begin
  if p_opt_out then
    update public.contacts
      set opted_out_sms = true,
          opted_out_at  = now()
      where regexp_replace(coalesce(phone, ''), '\D', '', 'g') like '%' || p_phone_suffix
        and opted_out_sms is distinct from true;
  else
    update public.contacts
      set opted_out_sms = false,
          opted_out_at  = null
      where regexp_replace(coalesce(phone, ''), '\D', '', 'g') like '%' || p_phone_suffix
        and opted_out_sms is distinct from false;
  end if;

  get diagnostics rows_affected = row_count;
  return rows_affected;
end;
$$;

-- Restrict execution. The webhook route uses the service_role client;
-- nobody else should be able to flip opt-out state via this RPC.
revoke all on function public.set_sms_opt_out_by_phone_suffix(text, boolean) from public;
revoke all on function public.set_sms_opt_out_by_phone_suffix(text, boolean) from anon, authenticated;
grant execute on function public.set_sms_opt_out_by_phone_suffix(text, boolean) to service_role;
