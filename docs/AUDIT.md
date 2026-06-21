# Tarhunna — Baseline Audit

_Point-in-time snapshot of the repository. No speculation; items not in the repo are marked **not present**. BAA/contractual posture is explicitly out of scope (not verifiable from code)._

---

## Executive summary (one-page skim)

**What Tarhunna is today.** A multi-tenant CRM for med spas and aesthetic clinics. Core flow is wired: public lead-capture form → contact in an org-scoped pipeline → consultation scheduled → automated email/SMS follow-up. Single paid plan via Stripe ($297/mo). Clinic staff log in; patients do not.

**Stack.** Next.js 16 App Router (16.2.3) + React 19.2.4 + TS 5. Supabase (Postgres) for DB + Auth. Raw Supabase client queries — no ORM. Resend for email, Twilio for SMS, Stripe for billing. Vercel-ready (no `vercel.json`). No observability, no tests, no CI.

**What's solid.**
- Auth + org-scoping is enforced **both** at the query level (`.eq('organization_id', ...)`) and at the RLS layer (`org_isolation` policies on every tenant table). Defense-in-depth is real, not performative.
- `proxy.ts` gates dashboard/admin routes and enforces trial expiry.
- Stripe webhook is signature-verified. Cron endpoint is bearer-token gated.
- Structured audit trail exists in `activity_log` (lead_created, email_sent, stage_changed, etc.) and `sms_log` per-message.

**What's weak or missing.**
- **Zero automated tests.** No vitest/jest/playwright, no CI workflow.
- **No observability.** No Sentry, no PostHog, no structured logger — just `console.log`/`console.error`.
- **No `.env.example`.** Every secret lives in `.env.local` only — new deployments have no manifest.
- **No feature flags or retry/timeout config** on any external client (Stripe, Twilio, Resend). Direct SDK use in handlers.
- **Fire-and-forget `enrollContact(...).catch(console.error)` pattern** in 4 route handlers. On Vercel's serverless runtime, unawaited promises after `NextResponse.json(...)` may be killed mid-flight (there is already a known-bug memo about this).
- **Potential PHI leakage** via `console.error(..., err)` in `automation-engine.ts:107` and `consultation-reminders.ts:196` — the error object can carry contact fields.
- **No `vercel.json` cron config.** `/api/cron` exists but needs an external scheduler to fire.
- **Roadmap gaps:** no Meta/Facebook integration (no tokens on org, no raw-payload storage), no calendar integration (Google/Cal.com), no AI provider, no customer-of-customer billing (only clinic subscriptions, not patient-facing payments).

**Blast radius for the planned expansion.** SMS is already wired (phone, `sms_consent`, `opted_out_sms`, org-level templates, `sms_log`). Payments work for clinic subscriptions. Meta and calendar integrations are greenfield — no columns, no tokens, no webhook storage. Before shipping those, we need: `.env.example`, typed clients with retries/timeouts/flags, tests for cross-org isolation, and a migration story (schema changes currently ship as ad-hoc `add-*.sql` files — not a reversible up/down pattern).

---

## 1. Stack inventory

| Layer | Choice | Evidence |
|---|---|---|
| Framework | Next.js **16.2.3** (App Router) | `package.json` |
| UI | React **19.2.4**, Tailwind, shadcn-style `components/ui` | `package.json`, `src/components/ui/` |
| Language | TypeScript **^5** | `package.json`, `tsconfig.json` |
| Node engines | not present | `package.json` has no `engines` field |
| Package manager | npm | `package-lock.json` present |
| Database | Supabase (Postgres) | `src/lib/supabase/{server,client,admin}.ts` |
| ORM / query layer | **None.** Raw `@supabase/ssr` + `@supabase/supabase-js` client queries | `src/lib/supabase/*` |
| Auth | Supabase Auth (via `@supabase/ssr`) | `src/lib/supabase/server.ts`, `src/proxy.ts` |
| Hosting | Vercel (inferred) — no `vercel.json`, no `Dockerfile`, no `netlify.toml` | — |
| Background jobs | **No job runner.** External cron hits `/api/cron` with bearer token | `src/app/api/cron/route.ts` |
| Email | Resend ^6.10.0 | `src/lib/resend.ts` |
| SMS | Twilio ^5.13.1 | `src/lib/twilio.ts` |
| Payments | Stripe ^22.0.1 (API `2026-03-25.dahlia`) | `src/lib/stripe.ts` |
| Calendar | not present | — |
| AI provider | not present | — |
| Analytics / telemetry | not present | — |
| Error tracking | not present | — |
| Lint / format | ESLint 9 (`eslint-config-next`). Prettier/Biome **not present** | `eslint.config.mjs` |
| Tests | **not present** — no vitest/jest/playwright, no test script, no `__tests__`, no `tests/` | `package.json` |
| CI | **not present** — no `.github/workflows/` | — |
| Env files | `.env.local` present; **`.env.example` not present** | — |

---

## 2. Domain model

### 2.1 Tables (Supabase / Postgres)

All tenant tables carry `organization_id` and have an `org_isolation` RLS policy. `set_updated_at` trigger on tables with `updated_at`.

**organizations** — tenant root
`id` (uuid, pk) · `name` · `slug` (unique) · `phone` · `email` · `website` · `timezone` (default `America/New_York`) · `stripe_customer_id` · `stripe_subscription_id` · `plan` (default `trial`) · `plan_status` (default `active`) · `procedures` (text[]) · `sms_enabled` · `sms_confirmation_enabled` · `sms_reminder_24h_enabled` · `sms_reminder_2h_enabled` · `sms_template_confirmation` · `sms_template_reminder_24h` · `sms_template_reminder_2h` · `created_at` · `updated_at`

**profiles** — staff users (1:1 with `auth.users`)
`id` (uuid, pk, FK → auth.users ON DELETE CASCADE) · `organization_id` (FK) · `full_name` · `email` · `role` (default `staff`) · `avatar_url` · timestamps

**contacts** — leads/patients
`id` · `organization_id` · `stage_id` (FK → pipeline_stages ON DELETE SET NULL) · `first_name` · `last_name` · `email` · `phone` · `date_of_birth` · `source` (website/referral/instagram/facebook/walkin/other) · `procedure_interest` (text[]) · `status` (lead/patient/inactive) · `is_archived` · `opted_out_sms` · `opted_out_email` · `sms_consent` · `notes` · `last_contacted_at` · `last_activity_at` · timestamps
Indexes: `contacts_org_idx`, `contacts_stage_idx`, `contacts_status_idx`, `contacts_email_idx`

**pipeline_stages** — `id` · `organization_id` · `name` · `color` · `position` · `is_default` · `created_at`

**tags** — `id` · `organization_id` · `name` · `color` · `created_at`. Unique `(organization_id, name)`.

**contact_tags** — PK `(contact_id, tag_id)`, cascading deletes.

**consultations**
`id` · `organization_id` · `contact_id` · `assigned_to` (FK → profiles) · `scheduled_at` · `duration_min` (default 60) · `type` (in_person/virtual) · `status` (scheduled/confirmed/completed/no_show/canceled/rescheduled) · `procedure_discussed` (text[]) · `pre_consult_notes` · `post_consult_notes` · `reminder_24h_sent` · `reminder_2h_sent` · timestamps
Indexes: org, contact, scheduled_at, status.

**automation_sequences** — `id` · `organization_id` · `trigger_stage_id` · `name` · `trigger_type` (new_lead/stage_changed/no_show/old_lead_reactivation/consultation_booked/consultation_completed) · `is_active` · timestamps

**sequence_steps** — `id` · `sequence_id` · `position` · `delay_hours` · `channel` (email/sms) · `subject` · `body` · `created_at`

**contact_sequence_enrollments** — `id` · `organization_id` · `contact_id` · `sequence_id` · `status` (active/paused/completed/canceled) · `current_step` · `next_step_at` · `enrolled_at` · `completed_at`
Unique active enrollment: `(contact_id, sequence_id) WHERE status='active'`. Index on `next_step_at WHERE status='active'`.

**messages** — unified email/SMS log
`id` · `organization_id` · `contact_id` · `sequence_step_id` · `channel` (email/sms) · `direction` (outbound/inbound, default outbound) · `status` (queued/sent/delivered/failed/opened) · `subject` · `body` · `to_address` · `from_address` · `provider_id` · `error_message` · `sent_at` · `opened_at` · `delivered_at` · `created_at`

**sms_log** — per-SMS delivery record (Twilio)
`id` · `organization_id` · `contact_id` · `consultation_id` · `message_type` (confirmation/reminder_24h/reminder_2h) · `to_number` · `body` · `status` (sent/failed/skipped) · `provider_id` (Twilio SID) · `error_message` · `sent_at`

**notifications** — internal staff alerts (new_lead / no_show / consultation_reminder / old_lead_triggered / reply_received)

**activity_log** — audit trail. `id` · `organization_id` · `contact_id` · `user_id` · `action` (text, **untyped**) · `metadata` (jsonb) · `created_at`

**demo_requests** — public marketing form (no org). `status` enum: new/contacted/booked/completed/cancelled.

Migration files:
- `supabase/migrations/001_initial_schema.sql` (core schema + RLS)
- `supabase/add-sms-settings.sql` (sms_log, org SMS fields, `contacts.sms_consent`)
- `supabase/add-procedures-column.sql`
- `supabase/add-demo-requests.sql` · `add-demo-preferred-time.sql` · `add-demo-contacted-status.sql`

### 2.2 Relations (textual ER)

```
organizations 1───N profiles
             1───N contacts ───N consultations
             1───N pipeline_stages ◄── contacts.stage_id
             1───N tags ◄─N─M─► contacts (via contact_tags)
             1───N automation_sequences 1───N sequence_steps
                                        1───N contact_sequence_enrollments ──► contacts
             1───N messages (channel = email|sms)
             1───N sms_log
             1───N notifications
             1───N activity_log
```

### 2.3 PHI / PII inventory

| Field | Table | Class |
|---|---|---|
| first_name, last_name | contacts | PII |
| email | contacts, messages.to_address, demo_requests | PII |
| phone | contacts, sms_log.to_number, demo_requests | PII |
| date_of_birth | contacts | PHI |
| procedure_interest (array) | contacts | PHI |
| notes | contacts | PHI (often clinical) |
| pre_consult_notes, post_consult_notes | consultations | PHI |
| procedure_discussed | consultations | PHI |
| body | messages, sms_log | PHI (contents of outbound/inbound clinical messages) |

### 2.4 Schema gap flags for the roadmap

**SMS** — mostly ready.
- `contacts.phone`: present. `contacts.sms_consent`: present. `contacts.opted_out_sms`: present.
- `sms_log`, `messages` (with `channel='sms'`): present.
- Org templates + kill switches: present (`sms_enabled`, 3 `sms_template_*` fields, 3 `*_enabled` flags).
- **Gap:** no per-org Twilio credentials (`account_sid`, `auth_token`, `from_number`) on `organizations`. Today Twilio creds come from process env → **the platform is single-tenant at the Twilio layer** (every clinic shares one Twilio number). If clinics are expected to send from their own number, this is a blocker.

**Payments** — ready for clinic subscriptions, not patient billing.
- `organizations.stripe_customer_id`, `stripe_subscription_id`, `plan`, `plan_status`: present.
- **Gap:** no `payments`, `invoices`, or patient-scoped subscription tables. If the expansion adds patient payments or deposits, the schema needs a new customer-of-customer model.

**Meta / Facebook** — **not present.**
- No `meta_access_token`, `fb_page_id`, `ad_account_id` on `organizations`.
- No raw-payload table for lead webhooks.
- `contacts.source` enum includes `facebook`/`instagram` but no field for `external_id` or `campaign_id` to tie a contact back to a Meta lead form.

**Audit log** — present but shallow.
- `activity_log` has `user_id`, `action`, `metadata (jsonb)`, `contact_id`, `created_at`.
- **Gap:** no `resource_type` column; `action` is untyped text. jsonb `metadata` is a catch-all with no shape contract. Querying "all deletes on consultations" is not first-class.

---

## 3. API surface

All routes under `src/app/api/**/route.ts`. Dashboard pages also read data server-side with the same auth+org-scoping pattern (spot-checked on `dashboard/page.tsx:76–89`). No `'use server'` server actions exist — mutations go through REST routes.

### 3.1 Authenticated routes (auth + org-scoping confirmed)

| Path | Methods | Purpose |
|---|---|---|
| `/api/billing/checkout` | POST | Create Stripe Checkout session (monthly only, setup fee removed) |
| `/api/billing/portal` | POST | Stripe billing portal link |
| `/api/leads` | GET, POST | List / create leads (POST also enrolls in automations) |
| `/api/leads/[id]/send-email` | POST | Templated email send, writes `messages` + `activity_log` |
| `/api/contacts/[id]` | GET, PATCH | Read / update a single contact |
| `/api/consultations` | GET, POST | List / create consultations; POST moves stage + fires automations + SMS |
| `/api/consultations/[id]` | PATCH | Update status/notes; may trigger stage moves |
| `/api/automations` | GET, POST | List / create automation sequences with steps |
| `/api/automations/[id]` | PATCH, DELETE | Update / delete sequence |
| `/api/org/procedures` | PATCH | Update `organizations.procedures` |
| `/api/org/sms-settings` | PATCH | Update `organizations.sms_*` |

Every route calls `supabase.auth.getUser()` (401 on failure) and filters queries with `.eq('organization_id', ...)`. RLS provides defense-in-depth.

### 3.2 Super-admin routes (`is_super_admin` gated)

| Path | Methods | Purpose |
|---|---|---|
| `/api/admin/demo-requests` | GET, PATCH | Read/update global demo request queue |
| `/api/admin/accounts/[id]` | PATCH | Modify a clinic's plan/status |

Gated both in route (`profile.is_super_admin` check) and in `proxy.ts` (`/admin/*` redirect-to-dashboard if not super-admin).

### 3.3 Public routes (intentional)

| Path | Methods | Scoping mechanism |
|---|---|---|
| `/api/auth/signup` | POST | Bootstrap — no pre-existing org |
| `/api/capture/[slug]` | GET, POST | Slug match on `organizations.slug`; cannot leak cross-org |
| `/api/demo` | POST | Writes to global `demo_requests`; no org |
| `/api/webhooks/stripe` | POST | Stripe signature verification; looks up org by subscription id |
| `/api/cron` | GET, POST | `Authorization: Bearer ${CRON_SECRET}` gate |

### 3.4 `src/proxy.ts` (Next.js 16 middleware)

- Matcher: `/((?!_next/static|_next/image|api/|.*\\..*).*)` — excludes Next internals, API, static files.
- Public paths: `/login`, `/signup`, `/capture`, `/billing`, `/med-spa-crm`, `/book-demo`, `/privacy`, `/terms`, `/sitemap.xml`, `/robots.txt`, `/icon.svg`.
- `/admin/*` requires `profile.is_super_admin = true` (redirect to `/dashboard` otherwise).
- Dashboard paths require login (redirect to `/login`).
- Authenticated users on `/login`, `/signup`, `/` are redirected to `/dashboard`.
- Trial-expired users on non-billing protected routes are redirected to `/settings`.

### 3.5 Cross-org exposure audit

No route was found that reads or writes org-scoped data without an `organization_id` filter. RLS policies mirror the filter. **No cross-org exposure detected.** What's missing is a **test that proves it** — see §7.

---

## 4. Background jobs & scheduling

### 4.1 Runner

No job runner library is installed (no Inngest, Trigger.dev, BullMQ, QStash, node-cron). Jobs are invoked by hitting `POST /api/cron` with a bearer token from an external scheduler.

**Schedule source: not in repo.** `vercel.json` does not exist, so the trigger is presumed to be an out-of-repo scheduler (cron-job.org / Upstash / manual). Cannot verify cadence from code.

### 4.2 What `/api/cron` does

`src/app/api/cron/route.ts` runs four jobs in `Promise.all`:

| Job | Source | Action |
|---|---|---|
| `processDueSteps()` | `src/lib/automation-engine.ts:89` | Advance `contact_sequence_enrollments` past `next_step_at` |
| `sendConsultationReminders()` | `src/lib/consultation-reminders.ts:14` | 24h and 2h reminder emails/SMS |
| `expireTrials()` | `src/lib/expire-trials.ts:7` | Flip `plan_status` to `trial_expired` past deadline |
| `sendTrialReminders()` | `src/lib/trial-reminders.ts:124` | Email clinics whose trial is ending |

### 4.3 Retry / timeout / failure handling

- **Retries:** none anywhere (cron jobs, Stripe, Twilio, Resend calls all lack retry policy).
- **Timeouts:** none configured; SDK defaults only.
- **Failure handling:** each job's errors are caught inside the handler and logged via `console.error`; if any top-level job throws, `/api/cron` returns 500. Individual per-enrollment or per-reminder failures do **not** retry — they're logged and the loop continues.

### 4.4 Fire-and-forget in route handlers

Four handlers kick off async work without awaiting it before returning the response:

| File | Line | Call |
|---|---|---|
| `src/app/api/leads/route.ts` | 134 | `enrollContact(...).catch(console.error)` |
| `src/app/api/capture/[slug]/route.ts` | 90 | `enrollContact(...).catch(console.error)` |
| `src/app/api/consultations/route.ts` | 161 | `enrollContact(...).catch(console.error)` |
| `src/app/api/consultations/[id]/route.ts` | 112, 138 | `.catch((err) => console.error(...))` |

On Vercel's serverless runtime, unawaited promises after `NextResponse.json(...)` can be killed when the function settles. **This pattern is called out in an existing project memo.** New-lead enrollments and stage-change automations may silently fail to run on cold-path traffic.

---

## 5. Integrations

### 5.1 Outbound clients

| Provider | Client file | Typed wrapper | Feature flag | Retries | Timeouts | Direct SDK in routes? |
|---|---|---|---|---|---|---|
| Stripe | `src/lib/stripe.ts` | Yes (singleton) | No | No | No (SDK default) | Yes — routes call `stripe.checkout.sessions.create` directly |
| Twilio | `src/lib/twilio.ts` | Yes (`sendSMS`, `renderTemplate`) | Env-gated only (`isTwilioConfigured()`) | No | No | No — goes through wrapper |
| Resend (email) | `src/lib/resend.ts` | Yes (`sendEmail`, `renderTemplate`, `wrapEmailHtml`) | No | No | No | No — goes through wrapper |
| Calendar (any) | not present | — | — | — | — | — |
| Meta / Facebook | not present | — | — | — | — | — |
| AI provider | not present | — | — | — | — | — |
| Analytics | not present | — | — | — | — | — |
| Error tracking | not present | — | — | — | — | — |

**Guardrail gap:** per the project's engineering rules, every external call should have a typed client **with retries, timeouts, and a feature flag**. Today none of the three wired integrations has all three. Stripe also bypasses its wrapper in handler code.

### 5.2 Webhooks

Only one: `POST /api/webhooks/stripe`.
- Signature-verified via `stripe.webhooks.constructEvent(...)` at `route.ts:39`.
- Does not persist raw payloads; logs subscription IDs and error messages to `console.error`. Low PHI risk.
- No Meta, Twilio status callback, Resend event, or generic webhook handler exists.

### 5.3 BAA status

**Not verifiable from the repository.** BAA posture with Supabase, Stripe, Twilio, and Resend must be confirmed out-of-band against vendor contracts.

---

## 6. HIPAA posture (signals extractable from code only)

| Control | Status | Evidence |
|---|---|---|
| Encryption at rest (app-level) | **Not present.** Relies on Supabase/Postgres infra-level encryption. | No pgcrypto, no field encryption in migrations. |
| Encryption in transit | HTTPS everywhere. No `http://` literals in code. | — |
| Security headers (HSTS, CSP, X-Frame-Options) | **Not present** in `proxy.ts` or `next.config`. | — |
| Row-level isolation | **Strong.** RLS enabled on every tenant table with `org_isolation` policy using `current_org_id()` helper. | `001_initial_schema.sql:352–413`, `add-sms-settings.sql:35–38` |
| Defense-in-depth org filtering | Enforced in every route query on top of RLS. | See §3. |
| Audit logging | `activity_log` writes for `lead_created`, `email_sent`, `stage_changed`, `contact_archived`, `note_added`. `sms_log` per SMS. | `api/leads/route.ts:126`, `api/leads/[id]/send-email/route.ts:102`, `api/contacts/[id]/route.ts:140–143` |
| PHI in logs — risk sites | **Potential leakage.** `console.error('Error processing enrollment step:', err)` and similar sites may stringify contact-bearing errors. | `automation-engine.ts:107`, `consultation-reminders.ts:196`, `api/demo/route.ts:150` (`JSON.stringify(emailErr)`) |
| PHI in error responses | Not observed. Routes return generic error strings. | — |
| Session timeout | **Supabase default, not customized.** | — |
| Password policy | **8-character minimum** in `api/auth/signup/route.ts:34`. No complexity rules; otherwise Supabase defaults. | — |
| Granular access control | Staff can see all contacts in their org. No per-staff scoping or role-based field masking. | — |

---

## 7. Test coverage

**Zero.** No test files, no test runner in `package.json`, no `vitest.config.*` / `jest.config.*` / `playwright.config.*`, no `tests/` or `__tests__/` directories, no `.github/workflows/`. `npm test` is not defined.

Lint is the only automated check: `npm run lint` via `eslint-config-next`.

---

## 8. Gaps & risks that block the roadmap

Ordered by how much they'll hurt the expansion. Each is a concrete thing to add, not a vibe.

1. **No `.env.example`** → deploying a second environment or onboarding a teammate is a scavenger hunt. Every new secret the expansion adds (Meta, calendar, AI) compounds this.
2. **No tests, no CI** → any refactor during expansion is a coin flip. Minimum viable bar: one cross-org isolation test per resource (lead, consultation, sequence) proving a user in org A gets 404/403 for org B rows. Add a CI workflow that runs lint + the isolation suite on PR.
3. **Fire-and-forget `enrollContact(...)` in 4 handlers** → lead automations can silently vanish on Vercel. Either `await` them (accepts the latency cost) or move them to the cron queue via an `enrollment_jobs` table.
4. **External clients lack retry/timeout/flag trio** → adding Meta Conversions API, Google Calendar, and OpenAI to this pattern multiplies outage surface. Build the wrapper contract (typed client with retries, timeout, kill switch) once and refactor Stripe/Twilio/Resend through it before adding the fourth and fifth integration.
5. **Schema changes ship as ad-hoc `add-*.sql`** → `001_initial_schema.sql` is numbered; subsequent files are not, and none have `down` migrations. Before the expansion adds Meta columns, payment tables, etc., adopt a reversible migration convention (numbered, `up.sql` + `down.sql`, or a tool like `supabase db push` with a versioned migrations dir).
6. **PHI may reach logs via `console.error(err)` paths** → `automation-engine.ts:107`, `consultation-reminders.ts:196`, `api/demo/route.ts:150`. Before adding Sentry/PostHog (which'll ship those errors off-box), scrub or replace these call sites.
7. **No per-org Twilio / Meta / calendar credentials on `organizations`** → today every clinic shares one Twilio number. If expansion includes clinic-owned numbers, Meta ad accounts, or Google Calendars, we need encrypted credential storage on the org (new columns + a KMS/secret strategy, since Supabase doesn't encrypt individual columns by default).
8. **`activity_log.action` is untyped; no `resource_type`** → can't reliably power a "security events" view or a customer-facing audit trail. Add an enum + resource_type before the log is consumed by any surfaced feature.
9. **No observability** → zero visibility into failed SMS sends, Stripe webhook drops, cron exceptions. Recommend Sentry for errors + PostHog or a structured logger for business events. Required for anything HIPAA-adjacent.
10. **Session timeout + password policy are Supabase defaults** → acceptable for V1, but worth revisiting before onboarding regulated clinics.
11. **No BAA verification surface** → add a `docs/VENDOR_BAA.md` tracking which vendors have signed BAAs, renewal dates, and scope. Not code, but the repo is the source of truth for almost everything else.

---

_End of audit. Snapshot reflects repository state at the time of this document; re-run against the repo before relying on any specific file:line citation._
