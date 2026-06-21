# Tarhunna — Feature Expansion Roadmap

_Ground truth: `docs/AUDIT.md`. This document sequences the planned expansion into small, independently shippable PRs. No implementation code — planning only._

---

## Sequencing summary

| Phase | Block | Why it's here | PR range |
|---|---|---|---|
| **Phase 0** | Foundations | Prerequisites pulled from AUDIT §8: without these, later PRs are unsafe or untestable. Not in the original 9 features, but non-negotiable. | 6–8 |
| **Phase 1** | Two-way SMS (Twilio) | User priority 1. Depends on Phase 0 and on HIPAA field-level encryption landing first. | 5–6 |
| **Phase 2** | Unified Inbox | User priority 2. Reuses the already-present `messages` table. Depends on Phase 1 inbound wiring. | 3–4 |
| **Phase 3** | HIPAA hardening | User priority 3. *Recommended to split: land field-level encryption + PHI-safe logger before Phase 1 (see Phase 0).* The remainder (BAA doc, session controls, audit-log hardening, compliance page) stays here. | 5–7 |
| **Phase 4** | Deposit-backed online booking | User priority 4. Biggest greenfield — no services catalog, no subdomain routing, no patient-side Stripe today. | 6–8 |
| **Phase 5** | Meta Lead Ads | User priority 5. Depends on Phase 6's UTM/attribution schema or ships its own subset first. | 4–5 |
| **Phase 6** | Attribution & reporting | User priority 6. Schema is tiny; most work is dashboards. Best to land UTM columns **before** Phase 5 captures Meta leads so nothing backfills awkwardly. | 3–5 |
| **Phase 7** | AI assist | User priority 7. Depends on Phase 2 inbox and Phase 6 attribution. | 4–5 |
| **Phase 8** | Post-consult nurture | User priority 8. Partially already wired — `consultation_completed` is already in `automation_sequences.trigger_type` (AUDIT §2.4). Smallest feature in the list. | 2–3 |
| **Phase 9** | Polish | User priority 9. Independent items — pricing page, calendar sync, intake templates, review automation. Ship as fillers between larger phases. | 7–8 |

**Total estimated PR count: 45–59.**

**Sequencing concerns to resolve with the user before starting:**

1. AUDIT §8 flags **no tests, no `.env.example`, no reversible migrations, fire-and-forget in 4 handlers**. Shipping Phase 1 on top of these amplifies risk. Phase 0 addresses them.
2. **HIPAA is priority 3 but gates Phases 1–2** if we want to avoid re-encrypting patient messages after the fact. I've split out a "HIPAA subset" into Phase 0: field-level encryption primitives, BAA-eligible provider confirmation, PHI-safe logger. The rest of HIPAA (audit log hardening, session controls, compliance page) stays as Phase 3.
3. **Phase 6's UTM columns are tiny and unblock Phase 5**. Recommend pulling UTM migration forward into Phase 0 or Phase 5's opener.

---

## Conventions for every phase

Every PR in every phase satisfies the project's engineering guardrails:

- **Migrations** are reversible: a numbered `NNN_name/up.sql` + `down.sql` pair. No more ad-hoc `add-*.sql`.
- **New secrets** get an `.env.example` entry the same PR they're introduced.
- **New external calls** go through a typed client with retries, timeouts, and a feature flag (AUDIT §5.1 — none of the three existing clients has this today; the Phase 0 wrapper contract is the new standard).
- **New routes** get a test that proves (a) auth required and (b) cross-org access returns 404/403.
- **PHI** (names, email, phone, DOB, procedure interest, notes, message bodies) never appears in logs, error responses, or telemetry.

These are the default test-plan floors for each phase and I won't re-state them per feature.

---

## Phase 0 — Foundations

Blockers surfaced by AUDIT §8. Six to eight small PRs; each lands independently.

### 0.1 Reversible migrations + migration tooling
- **Scope.** Adopt `supabase/migrations/NNN_name/` directory convention with `up.sql` + `down.sql`. Port existing `add-*.sql` files into the new layout. Document in `docs/MIGRATIONS.md`.
- **Acceptance.** `supabase db reset` reproduces the current schema from the new directory; `down.sql` for each new migration leaves the schema as it was.
- **Migrations.** None new — restructure existing.
- **Env.** None.
- **Test plan.** CI job runs `db reset` and a schema diff against a pinned snapshot.
- **PRs.** 1. **Deps.** None.

### 0.2 `.env.example`
- **Scope.** Enumerate every env var read anywhere in `src/`. Write placeholder values. Add a pre-commit check that fails if a new `process.env.FOO` reference has no `.env.example` entry.
- **Acceptance.** A fresh clone can read the full required-secret list from one file.
- **Migrations.** None.
- **Env.** Documents all existing (Supabase, Stripe, Twilio, Resend, CRON_SECRET, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL).
- **Test plan.** Lint rule / script in CI.
- **PRs.** 1. **Deps.** None.

### 0.3 Test harness + CI
- **Scope.** Install Vitest + Testing Library + a Supabase test-DB helper (Docker Compose or local Supabase). Add `npm test` script. Add `.github/workflows/ci.yml` running `lint + typecheck + test` on PR.
- **Acceptance.** At least one smoke test passes on CI. `test:isolation` runs a single cross-org test against `/api/leads` proving user in org A gets 404/403 on org B rows.
- **Migrations.** None.
- **Env.** `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_ROLE_KEY` for local/CI.
- **Test plan.** The harness itself.
- **PRs.** 2 (harness; first isolation test). **Deps.** 0.1.

### 0.4 Typed external-client wrapper contract
- **Scope.** Define a `createClient({ retries, timeoutMs, flag })` helper. Refactor `src/lib/stripe.ts`, `src/lib/twilio.ts`, `src/lib/resend.ts` to use it. Each call gets a kill-switch env var (`INTEGRATION_TWILIO_ENABLED`, etc.). Stop direct `stripe.checkout.sessions.create` calls in route handlers — go through wrapper.
- **Acceptance.** Setting `INTEGRATION_TWILIO_ENABLED=false` causes `sendSMS` to return `{ skipped: true }` without throwing. Each wrapper logs outcome with a correlation ID, no PHI.
- **Migrations.** None.
- **Env.** `INTEGRATION_STRIPE_ENABLED`, `INTEGRATION_TWILIO_ENABLED`, `INTEGRATION_RESEND_ENABLED`.
- **Test plan.** Unit test for retries (exponential backoff, max attempts, timeout). Flag-off test returns `skipped`.
- **PRs.** 2 (contract + refactor). **Deps.** 0.2, 0.3.

### 0.5 PHI-safe structured logger
- **Scope.** Replace `console.error(..., err)` risk sites in `automation-engine.ts:107`, `consultation-reminders.ts:196`, `api/demo/route.ts:150` with a logger that serializes only `{ level, message, correlationId, resourceType, resourceId }`. Hard-deny PHI keys at the serializer level (deny-list: `email`, `phone`, `first_name`, `last_name`, `body`, `notes`, `date_of_birth`, `procedure_interest`).
- **Acceptance.** Grep for `console.error(` in `src/` returns zero outside `src/lib/log.ts`. Unit test asserts a `{ contact: { email: 'x' } }` payload emits `<redacted:email>` in the log line.
- **Migrations.** None.
- **Env.** None (may later add `LOG_LEVEL`).
- **Test plan.** Serializer unit test covers every deny-listed field.
- **PRs.** 1. **Deps.** 0.3.

### 0.6 Fix fire-and-forget enrollment (AUDIT §4.4)
- **Scope.** Convert `enrollContact(...).catch(console.error)` in the 4 cited handlers to either `await` or enqueue into a new `enrollment_jobs` table (processed by `/api/cron`).
- **Acceptance.** New-lead enrollments run reliably on Vercel; load test proves no silent drops.
- **Migrations.** `enrollment_jobs(id, organization_id, contact_id, sequence_trigger, payload jsonb, status, attempts, scheduled_at, created_at)` + index on `(status, scheduled_at)`.
- **Env.** None.
- **Test plan.** Integration test creates a lead, asserts enrollment row is produced, cron tick processes it, contact appears in `contact_sequence_enrollments`.
- **PRs.** 1–2. **Deps.** 0.1, 0.3.

### 0.7 HIPAA subset pulled forward (field-level encryption primitives + BAA inventory)
- **Scope.** Add `pgcrypto` extension and a `crypt.encrypt(text, key_version)` / `crypt.decrypt(ciphertext)` helper used by app code. Introduce `ENCRYPTION_KEY` (KMS-wrapped or 32-byte base64). Separately, create `docs/VENDOR_BAA.md` listing every vendor that will see PHI, BAA status, renewal date.
- **Acceptance.** A new encrypted column type is available for subsequent migrations. VENDOR_BAA.md lists Supabase, Stripe, Twilio, Resend, plus any Phase-3-introduced replacements, with BAA state marked `signed` / `pending` / `not-applicable`.
- **Migrations.** `create extension pgcrypto;` if not present. No table changes yet.
- **Env.** `ENCRYPTION_KEY` (+ `ENCRYPTION_KEY_VERSION` for rotation).
- **Test plan.** Round-trip unit test: encrypt → decrypt returns original. Negative test: wrong key fails cleanly.
- **PRs.** 1–2. **Deps.** 0.1.

### 0.8 Observability baseline
- **Scope.** Wire Sentry for errors (server + client), with the PHI-safe serializer as a `beforeSend` hook. Route `/api/cron` and webhook failures into a Sentry release.
- **Acceptance.** A thrown error from a route appears in Sentry within 30s with no PHI in the breadcrumb trail or request body.
- **Migrations.** None.
- **Env.** `SENTRY_DSN`, `SENTRY_ENVIRONMENT`.
- **Test plan.** Manual: throw in a staging route, confirm Sentry captures it and that request body is scrubbed. Automated: `beforeSend` unit test asserts PHI keys are stripped.
- **PRs.** 1. **Deps.** 0.5.

---

## Phase 1 — Two-way SMS (Twilio)

### Scope
Per-clinic phone number, outbound sends via clinic's own number, inbound messages captured, STOP/HELP compliance, opt-in proof, all messages visible on the Contact timeline.

### User-facing acceptance criteria
- Clinic admin can enter a Twilio Account SID, Auth Token, and purchased phone number in Settings → SMS. Credentials persist, are never shown in plaintext after save, and test-send succeeds.
- Outbound SMS sent from `/contacts/:id` or automations uses the clinic's number.
- A patient texting the clinic's number creates a `messages` row linked to the matching `contacts.phone`; staff see a browser notification.
- A patient replying `STOP` sets `contacts.opted_out_sms = true` and blocks all future outbound. Replying `HELP` triggers a configurable auto-reply.
- New-lead form captures explicit SMS consent checkbox → `contacts.sms_consent = true` with timestamp in `activity_log`.
- Contact timeline shows outbound + inbound SMS in chronological order alongside emails.

### DB migrations
- Extend `organizations` with encrypted credentials: `twilio_account_sid_cipher`, `twilio_auth_token_cipher`, `twilio_phone_number`, `twilio_messaging_service_sid` (nullable). Uses Phase 0.7 pgcrypto helper.
- New column `contacts.sms_consent_at timestamptz` (existing `sms_consent boolean` stays) so we have proof-of-consent.
- Extend `messages.direction` to clearly allow `inbound`; add `messages.provider_raw jsonb` for webhook body (scrubbed of PHI if stored, or store full-and-encrypt per compliance decision).
- Drop deprecated `sms_log` migration — or keep read-only — and flip writes to `messages` unified. TBD per PR.

### New env vars
- `TWILIO_WEBHOOK_AUTH_TOKEN` (if we adopt a platform-level secret in addition to per-org auth).
- `NEXT_PUBLIC_APP_URL` is already present and used for webhook URL.

### Test plan
- Unit: STOP/HELP parser handles case, whitespace, non-ASCII, multi-word replies.
- Integration: inbound webhook with mock Twilio signature is accepted; forged signature is 403.
- Integration: outbound send when `opted_out_sms=true` is rejected before Twilio call.
- **Cross-org isolation:** inbound webhook for org A cannot create a message on org B even if an attacker forges the `To` number.
- Consent: creating a lead without `sms_consent` does not allow outbound SMS.

### Estimated PRs: 5–6
1. Org-level encrypted Twilio credentials + Settings UI + test-send button.
2. Typed Twilio client resolving per-org creds (replaces env fallback). Flag-gated fallback to platform number during cutover.
3. Inbound webhook `/api/webhooks/twilio` with signature verification + message persistence.
4. STOP/HELP handling + consent capture on capture form + activity_log entries.
5. Contact timeline UI (reads unified `messages`).
6. *(optional)* Deprecation of `sms_log` writes.

### Dependencies
- Phase 0.4 (typed client), Phase 0.5 (logger), Phase 0.6 (no fire-and-forget), Phase 0.7 (encrypted Twilio creds).

---

## Phase 2 — Unified Inbox ("Conversations")

### Scope
Single threaded view per Contact spanning email + SMS. Channel-aware composer. Unread state per org.

### User-facing acceptance criteria
- New nav item "Conversations" lists every contact with unhandled inbound messages, newest first, with unread count badge.
- Clicking a contact opens a threaded view with email + SMS interleaved by timestamp.
- Composer auto-selects the channel the patient last used; staff can override. Composer is disabled if contact is opted out on that channel.
- Marking a thread "resolved" clears the badge; the state is per-org, not per-user.
- Keyboard: `j`/`k` next/prev, `Enter` open, `r` reply.

### DB migrations
- `messages.is_read boolean default false`, `messages.resolved_at timestamptz`.
- Index `messages_unread_idx on (organization_id, is_read) where direction='inbound' and is_read=false`.

### New env vars
None.

### Test plan
- Unit: channel picker defaults to last-used inbound channel, respects opt-out.
- Integration: sending via composer writes a `messages` row with correct `sequence_step_id=null`, `direction=outbound`.
- Cross-org isolation: user in org A cannot open a thread for a contact in org B via direct URL.
- Realtime: Supabase realtime subscription delivers inbound message to the open thread (if realtime is used; otherwise poll).

### Estimated PRs: 3–4
1. Inbox list view + unread count + query layer.
2. Thread view + channel-interleaved timeline.
3. Composer with channel picker + opt-out guard.
4. *(optional)* Realtime subscription + keyboard shortcuts.

### Dependencies
- Phase 1 (inbound webhook must be live for inbox to show SMS replies).

---

## Phase 3 — HIPAA hardening (remaining)

### Scope
Everything in the user's HIPAA bullet that isn't already in Phase 0.7 and 0.8: BAA-eligible provider switch, field-level encryption applied to PHI columns, append-only audit log enforcement, session controls, public compliance posture page.

### User-facing acceptance criteria
- All vendors touching PHI have a signed BAA; `docs/VENDOR_BAA.md` and `/compliance` reflect the same state.
- PHI columns (`contacts.email`, `phone`, `date_of_birth`, `notes`; `consultations.pre_consult_notes`, `post_consult_notes`; `messages.body`, `to_address`; `sms_log.to_number`, `body`) are stored encrypted at rest at the application layer. A DB dump without `ENCRYPTION_KEY` is unreadable.
- `activity_log` is append-only: RLS + grant configuration blocks UPDATE/DELETE except via a named rotation job.
- Sessions expire after 15 minutes of inactivity (configurable); passwords require ≥12 chars and can't match common-breach lists.
- `/compliance` page (public) documents: data flow, encryption, retention, vendor BAAs, breach notification contact.

### DB migrations
- Backfill migrations converting the PHI columns listed above to encrypted form. Each migration is reversible: `up` encrypts in place (`UPDATE ... SET col = crypt.encrypt(col)`), `down` decrypts. Column types become `bytea` or a dedicated `encrypted_text` domain.
- `activity_log` policies changed from `FOR ALL` to `FOR INSERT, SELECT`; a separate `activity_log_archive` table for old-data rotation.
- New `user_sessions` table or Supabase auth config extended with inactivity tracking (depends on whether we adopt Supabase's built-in timeout or a custom one).

### New env vars
- `SESSION_IDLE_TIMEOUT_MINUTES` (default 15).
- `PASSWORD_MIN_LENGTH` (default 12).
- `ENCRYPTION_KEY_VERSION` (for rotation).

### Test plan
- Encryption round-trip tests per column family.
- Append-only log: attempt direct UPDATE/DELETE on `activity_log` as each role — all must fail.
- Session: stale session after `SESSION_IDLE_TIMEOUT_MINUTES` is rejected by `proxy.ts`.
- Password: signup rejects `password123`, known-breach samples.
- Compliance page renders without auth and without leaking any env value.

### Estimated PRs: 5–7
1. Provider BAA switch (may require replacing Resend if BAA unavailable — flag early).
2. PHI column encryption migration (split by table: contacts, consultations, messages).
3. `activity_log` append-only + archive table.
4. Session controls (idle timeout in `proxy.ts`).
5. Password policy upgrade on signup + force-reset flag for existing users.
6. `/compliance` public page.

### Dependencies
- Phase 0.7 (pgcrypto + BAA doc). Must land before Phase 1 in practice — see Sequencing summary.

---

## Phase 4 — Deposit-backed online booking

### Scope
Public booking page at `{clinic}.tarhunna.net/book`. Service catalog per clinic. Stripe PaymentIntent holds a deposit at booking; deposit refunds on cancel inside policy window, keeps on no-show.

### User-facing acceptance criteria
- Clinic admin defines services: name, duration, price, deposit amount, cancellation policy (hours).
- Public booking page shows services, pulls open slots from the clinic's calendar (integrates with Phase 9.2 calendar sync; uses a simple availability table until then).
- Patient selects slot + service, enters contact info, pays deposit via Stripe Elements. On success a `consultations` row is created with `status='scheduled'` and a linked `payments` row.
- Patient cancellation link: cancel inside policy → `consultations.status='canceled'`, deposit refunded automatically, patient emailed receipt; cancel outside policy → status canceled, deposit forfeited.
- No-show handled by staff marking `status='no_show'`; no automatic refund.

### DB migrations
- `services (id, organization_id, name, duration_min, price_cents, deposit_cents, cancellation_window_hours, is_active, created_at)`.
- `consultations.service_id` FK (nullable for legacy rows).
- `payments (id, organization_id, contact_id, consultation_id, stripe_payment_intent_id, amount_cents, status, refunded_cents, created_at, updated_at)`.
- `availability_slots (id, organization_id, starts_at, ends_at, capacity, booked_count)` — placeholder until calendar sync lands.
- `organizations.subdomain_slug` already present as `slug`; add `custom_domain` optional.

### New env vars
- `STRIPE_CONNECT_CLIENT_ID` if we adopt Stripe Connect so clinics receive funds directly (vs platform-holds). Decision required early.
- `BOOKING_SUBDOMAIN_SUFFIX` (e.g., `.tarhunna.net`).

### Test plan
- Unit: refund-window calculator handles timezones correctly (clinic `timezone` field).
- Integration: booking flow end-to-end using Stripe test clock.
- Cross-org isolation: booking page for `{clinicA}.tarhunna.net` cannot book into clinic B.
- Double-booking: concurrent requests for the same slot — only one succeeds.
- Refund correctness: cancel-in-policy triggers a partial-refund event and `payments.refunded_cents` updates on Stripe webhook.

### Estimated PRs: 6–8
1. Services catalog (schema + admin UI).
2. Subdomain routing (middleware + wildcard DNS).
3. Public booking page (UI + slot picker).
4. Stripe PaymentIntent integration + Elements form.
5. Booking confirmation → create consultation + payment.
6. Cancellation flow + refund engine.
7. Stripe webhook extensions for PaymentIntent and refund events.
8. *(optional)* Stripe Connect vs platform-hold decision + implementation.

### Dependencies
- Phase 0.4 (Stripe wrapper with retries), Phase 3 (PHI encryption — booking page collects patient data), Phase 9.2 (calendar sync — nice-to-have; can ship with static availability first).

---

## Phase 5 — Meta Lead Ads integration

### Scope
OAuth to a clinic's Facebook page, subscribe to `leadgen` webhook, map incoming leads into `contacts` with UTMs and ad metadata preserved.

### User-facing acceptance criteria
- Settings → Integrations → Meta: "Connect Facebook Page" launches OAuth; on success the page name and ad account name display.
- Leads from Meta Lead Ads appear in the CRM within 60 seconds with `source='facebook'`, `lead_source_id` = Meta lead id, UTMs captured if present in the lead form, ad/campaign/creative ids preserved.
- Disconnecting removes the webhook subscription and the stored access token.

### DB migrations
- Extend `organizations`: `meta_access_token_cipher`, `meta_page_id`, `meta_ad_account_id`, `meta_connected_at` (nullable). Encrypted via Phase 0.7.
- Extend `contacts`: `external_id`, `external_source` (`'meta'`, later `'google'`), `ad_campaign_id`, `ad_set_id`, `ad_creative_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`.
- New `inbound_webhook_events (id, organization_id, provider, raw_payload_cipher, received_at, processed_at, error)` — append-only; encrypted payload.

### New env vars
- `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`.

### Test plan
- Unit: webhook signature verification (X-Hub-Signature-256).
- Integration: posting a Meta leadgen payload creates a `contacts` row with expected fields; idempotent on retry (same `lead_id` doesn't duplicate).
- OAuth: replay-attack with stale code returns error cleanly.
- Cross-org isolation: Meta webhook posting `page_id` for org A cannot write into org B's contacts.
- PHI: raw payload is stored encrypted; logger never emits lead email/phone.

### Estimated PRs: 4–5
1. UTM + ad metadata schema + capture-form UTM passthrough *(or fold into Phase 6 if we sequence it first)*.
2. `inbound_webhook_events` append-only table.
3. Meta OAuth flow + encrypted token storage.
4. Meta `leadgen` webhook + contact mapping.
5. Settings UI to connect/disconnect + health indicator.

### Dependencies
- Phase 0.7 (encryption for tokens and raw payloads). Ideally Phase 6 UTM migration lands first.

---

## Phase 6 — Attribution & reporting

### Scope
UTM on every new contact, dashboards for CPL / lead→consult / consult→booked by source and by procedure, date-range filter.

### User-facing acceptance criteria
- Every new contact from `/capture/:slug` carries UTMs read from the referring URL.
- Dashboard shows: leads by source (bar), CPL (if cost data provided via Meta), lead→consult % (by source and by procedure), consult→booked % (by source and by procedure), date-range picker (7/30/90/custom).
- CSV export of the underlying table.

### DB migrations
- UTM columns on `contacts` (if not already landed with Phase 5): `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`. Indexes on `(organization_id, utm_source)` and `(organization_id, created_at)` for dashboard queries.
- Materialized view `mv_funnel_daily (organization_id, day, source, procedure, leads, consults, booked)` refreshed by `/api/cron`.

### New env vars
None.

### Test plan
- Unit: URL UTM parser ignores garbage keys, caps string lengths.
- Integration: funnel aggregate over a seeded dataset matches hand-computed expected values.
- Cross-org isolation: dashboard query against a malformed `organization_id` cookie returns empty set, never leaks.

### Estimated PRs: 3–5
1. UTM schema + capture-form passthrough.
2. Aggregation query + materialized view + cron refresh.
3. Dashboard UI with date-range picker.
4. *(optional)* CSV export.
5. *(optional)* Cost-per-lead input surface for Meta (ties to Phase 5).

### Dependencies
- Ideally ships before Phase 5 so Meta leads land into populated columns.

---

## Phase 7 — AI assist

### Scope
Reply-draft suggestions in the inbox, lead scoring, cold-lead re-engagement suggestions. Pluggable provider behind a feature flag.

### User-facing acceptance criteria
- Inbox composer shows "Suggest reply" button — on click, an AI-generated draft appears, editable before send. Draft does not auto-send.
- Each contact shows a score `0–100` with a one-line "why" (e.g., "opened 3 emails, clicked book link, replied within 24h").
- Weekly "Cold lead re-engagement" panel surfaces up to 20 contacts and suggests which automation to enroll them in.
- A single env flag `AI_ASSIST_ENABLED=false` turns the entire feature off cleanly (no orphan UI).

### DB migrations
- `contact_scores (id, organization_id, contact_id, score, features jsonb, model_version, computed_at)`. Indexed on `(organization_id, score desc)`.
- `ai_events (id, organization_id, provider, model, prompt_tokens, completion_tokens, cost_cents, latency_ms, created_at)` for cost observability. No PHI.

### New env vars
- `AI_ASSIST_ENABLED`.
- `AI_PROVIDER` (`openai` | `anthropic` | `none`).
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (only required if selected).
- `AI_MAX_TOKENS_PER_REQUEST`, `AI_DAILY_COST_CAP_CENTS`.

### Test plan
- Unit: provider abstraction — switching `AI_PROVIDER` changes the client without behavior drift.
- PHI safety: prompts are constructed from whitelisted fields only; a test seeds a contact with `notes='SSN 123-45-6789'` and asserts SSN does not appear in the outbound prompt.
- Flag off: UI hides the suggest button; no AI SDK import is executed.
- Cost cap: exceeding `AI_DAILY_COST_CAP_CENTS` returns a safe "unavailable" message and logs a warning, not an error.

### Estimated PRs: 4–5
1. Pluggable provider + flag infrastructure.
2. Reply-draft button in inbox composer.
3. Lead scoring job + contact badge.
4. Cold-lead re-engagement panel.
5. *(optional)* Cost dashboard for AI usage.

### Dependencies
- Phase 2 (inbox) for reply drafts. Phase 6 (attribution/features) improves lead-scoring accuracy. Phase 3 (HIPAA provider BAA) — OpenAI/Anthropic BAA status must be confirmed before any PHI is sent.

---

## Phase 8 — Post-consult nurture + re-engagement

### Scope
New sequence trigger types: `consultation_completed` (already in the `automation_sequences.trigger_type` enum per AUDIT §2, but no job wires it), `lead_cold_60`, `lead_cold_90`, `lead_cold_180`.

### User-facing acceptance criteria
- Clinic admin creates a sequence with trigger = "After consultation completed" and delay = "3 days" → patients whose consult is marked `completed` receive the step 3 days later.
- Cold-lead triggers evaluate nightly: a contact with `status='lead'` and no activity in 60/90/180 days is enrolled in the corresponding sequence (once per cold band, not repeatedly).
- Clinic admin sees in the automation editor which contacts are currently enrolled.

### DB migrations
- Add enum values to `automation_sequences.trigger_type`: `lead_cold_60`, `lead_cold_90`, `lead_cold_180`. `consultation_completed` already exists.
- Index on `contacts (organization_id, last_activity_at)` to make nightly cold-scan cheap.
- `contact_sequence_enrollments` already prevents duplicate active enrollments via the existing partial unique index.

### New env vars
None.

### Test plan
- Unit: cold-scan boundary (59 vs 60 days).
- Integration: completing a consultation enrolls the contact; re-completing (e.g., status toggled) does not double-enroll.
- Idempotency: cron tick twice in one day produces identical enrollments, no duplicates.

### Estimated PRs: 2–3
1. Enum migration + automation UI trigger options.
2. Cron job for cold-lead scan + `consultation_completed` wiring into the existing engine.
3. *(optional)* Enrolled-contacts view in automation editor.

### Dependencies
- Phase 0.6 (reliable enrollment path).

---

## Phase 9 — Polish

Independent items, good filler between larger phases.

### 9.1 Public pricing page
- **Scope.** `/pricing` page. $297/mo, feature list, FAQ, CTA to signup. SEO-friendly.
- **AC.** Page renders pre-auth, lists current plan, CTAs land on `/signup`. Indexed by Google.
- **Migrations.** None.
- **Env.** None.
- **Tests.** Snapshot + a11y.
- **PRs.** 1. **Deps.** None.

### 9.2 Google/Outlook calendar sync
- **Scope.** OAuth to Google Calendar and Microsoft Graph; two-way sync of consultations to the assigned staff member's calendar.
- **AC.** Connecting a calendar in Settings pushes existing consultations as events; creating a consultation creates an event; editing the event in Google updates the consultation (subject to conflict policy).
- **Migrations.** `user_calendar_connections (id, profile_id, provider, access_token_cipher, refresh_token_cipher, calendar_id, synced_until, created_at)`. `consultations.external_event_id`, `consultations.external_event_provider`.
- **Env.** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, their OAuth redirect URLs.
- **Tests.** OAuth happy path, token refresh, conflict-resolution unit tests, cross-org isolation (staff in org A cannot see consultations in org B regardless of which calendar is connected).
- **PRs.** 3–4. **Deps.** Phase 0.4, Phase 0.7.

### 9.3 Procedure-specific intake form templates
- **Scope.** Per-procedure intake forms (e.g., botox has different questions than weight loss). Clinic admin can toggle which fields appear, add custom questions.
- **AC.** Public capture page shows procedure-specific fields if a procedure is pre-selected. Submissions store answers as `contacts.intake_answers jsonb`.
- **Migrations.** `intake_form_templates (id, organization_id, procedure, fields jsonb, is_active)`. `contacts.intake_answers jsonb` (encrypted per Phase 3 PHI policy).
- **Env.** None.
- **Tests.** Schema validation for answers against template; cross-org isolation on template access.
- **PRs.** 2. **Deps.** Phase 3 (PHI encryption on intake answers).

### 9.4 Google review request automation after consultation
- **Scope.** Automation trigger (or new sequence step type) that, X days after `consultations.status='completed'`, sends a templated review-request message with a per-clinic Google review link.
- **AC.** Clinic admin sets review link in Settings. Completion → X days later, email/SMS goes out with the link. Patient can opt out.
- **Migrations.** `organizations.google_review_url text`. No other changes — reuses `automation_sequences` and `sequence_steps`.
- **Env.** None.
- **Tests.** Template rendering; opt-out respected; no double-sends for the same consultation.
- **PRs.** 1. **Deps.** Phase 8 (consultation_completed wiring).

---

## Cross-cutting assumptions

- **Single-repo monolith.** No microservices are proposed.
- **Supabase as both DB and auth.** No auth migration.
- **No new framework.** Per the engineering guardrails: Next.js App Router + Supabase + Tailwind + shadcn. No Prisma/Drizzle, no alternate UI kit, no job-runner service — fire-and-forget fix and `enrollment_jobs` stay inside the app + Postgres.
- **Feature flag naming.** `INTEGRATION_<PROVIDER>_ENABLED` for external calls; `FEATURE_<NAME>_ENABLED` for user-facing features.
- **PR size.** Target: each PR is reviewable in under 30 minutes and deployable independently behind flags.

---

## Open questions before kickoff

1. **Sequencing override:** confirm the recommendation to pull Phase 0.7 (pgcrypto + BAA doc) and parts of Phase 3 (PHI-safe logger) before Phase 1. Accept or reject.
2. **Stripe Connect vs platform-hold for Phase 4 deposits.** Revenue-share, refund mechanics, and KYC obligations all differ. Needs a product call before Phase 4 PR #1.
3. **Resend BAA status.** If Resend cannot sign a BAA, Phase 3 PR #1 becomes "migrate to a BAA-eligible ESP." That's a ~1 week detour; worth knowing early.
4. **AI provider choice.** Phase 7 assumes OpenAI or Anthropic. BAA posture of each must be verified before any PHI is sent. Safer default: scrub PHI out of prompts regardless.
5. **Subdomain vs path for booking pages.** Phase 4 assumes `{clinic}.tarhunna.net/book`. Alternative: `tarhunna.net/{clinic}/book` — cheaper DNS, worse brand.

_End of roadmap._
