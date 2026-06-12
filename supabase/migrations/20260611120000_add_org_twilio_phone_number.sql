-- Per-org Twilio number for inbound SMS routing.
-- Inbound webhook routes by the To number → owning org → contacts in that org.
-- Deliberately empty backfill: the production org's number is set manually
-- via a one-off SQL command so a wrong value doesn't ride into git history.
-- See: src/app/api/webhooks/twilio/inbound/route.ts
alter table public.organizations
  add column twilio_phone_number text;

-- Partial unique: orgs without a Twilio number (most, today) can coexist;
-- two orgs can never claim the same number.
create unique index organizations_twilio_phone_number_unique
  on public.organizations(twilio_phone_number)
  where twilio_phone_number is not null;
