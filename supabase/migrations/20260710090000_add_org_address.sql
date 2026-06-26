-- Phase 5 W2 — Organization street address for the call agent's
-- `give_directions` tool.
--
-- Layla (the Vapi voice assistant) needs a structured clinic address
-- so she can answer "where are you located?" / "how do I get there?"
-- without each owner having to bake the address into the greeting
-- copy. The fields here are the inputs to a tool call that returns
-- a spoken directions blurb plus an optional SMS follow-up with a
-- Google Maps link (built from google_place_id when set, else from
-- the address lines).
--
-- All columns are NULL-able with no default — orgs that don't enable
-- the call agent (or don't want directions answered) simply leave
-- these blank, and the tool politely declines on the call. The owner
-- edits them in /settings/call-agent under the new "Clinic address"
-- sub-section.
--
-- Why a separate google_place_id column instead of deriving it on
-- the fly: the Places API has per-lookup cost + latency, and the
-- place id is stable per location. Owner pastes it once (or we
-- resolve it server-side on first save in a future patch) and every
-- subsequent directions tool call reuses it for a deterministic
-- Maps deep-link.
--
-- directions_notes is a free-form text field for the human nuance a
-- street address can't carry — "park in the back lot, second
-- entrance", "buzz #204 at the gate", "the building is the one with
-- the blue awning". Layla reads it verbatim at the end of the
-- directions response when present.

alter table public.organizations
  add column if not exists address_line1     text,
  add column if not exists address_line2     text,
  add column if not exists city              text,
  add column if not exists region            text,
  add column if not exists postal_code       text,
  add column if not exists country_code      text,
  add column if not exists google_place_id   text,
  add column if not exists directions_notes  text;

comment on column public.organizations.address_line1 is
  'Phase 5 W2: street address line 1. Input to the call agent give_directions tool.';

comment on column public.organizations.address_line2 is
  'Phase 5 W2: street address line 2 (suite, unit, floor). Optional.';

comment on column public.organizations.region is
  'Phase 5 W2: state / province / region. Free-form text; not validated against an ISO list because international orgs use varied conventions.';

comment on column public.organizations.country_code is
  'Phase 5 W2: ISO 3166-1 alpha-2 country code (US, CA, MX, ...). Free-form text at the DB layer; UI presents a select.';

comment on column public.organizations.google_place_id is
  'Phase 5 W2: Google Maps place id for the clinic. When present, the give_directions tool builds a deterministic maps.google.com/?q=place_id:... deep-link instead of geocoding the address each call.';

comment on column public.organizations.directions_notes is
  'Phase 5 W2: free-form parking / wayfinding nuance Layla reads at the end of the directions response ("park in the back lot", "buzz #204 at the gate"). Optional.';
