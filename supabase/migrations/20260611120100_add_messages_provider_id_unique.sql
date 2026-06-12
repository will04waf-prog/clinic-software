-- Dedup inbound webhook retries: Twilio retries on non-2xx, and we should
-- never store the same MessageSid twice. provider_id is nullable on legacy
-- rows (drafts that failed to send before provider_id was tracked), so the
-- index is partial.
create unique index messages_provider_id_unique
  on public.messages(provider_id)
  where provider_id is not null;
