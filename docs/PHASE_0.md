# Phase 0 — Lean Foundations

_Prerequisite work that must land before Phase 1 (two-way SMS). Derived from `docs/AUDIT.md` §8 and sequenced per `docs/ROADMAP.md`. This document is the canonical execution plan for Phase 0._

---

## Summary

**5 PRs. ~4–5 days of solo engineering. Zero user-facing features.**

What this buys:
- Stops an active enrollment-drop bug on Vercel (§PR1).
- Closes the three concrete PHI-leak sites identified in the audit (§PR3).
- Lights up production error visibility for the first time (§PR4).
- Establishes encryption + BAA primitives so Phase 1's Twilio credentials land encrypted on first write, not retroactively (§PR5).
- Gives any future teammate or environment a single source of truth for required secrets (§PR2).

**What it explicitly does *not* do** (deferred to later phases to preserve product momentum):
- No comprehensive test harness. One cross-org isolation test ships with Phase 1 PR #1 instead.
- No reversible-migration restructure. That happens inside Phase 1 PR #1 (it's writing migrations anyway — two for the price of one).
- No retry/timeout contract on external clients. Kill-switch flags land in PR4; full retries land with Phase 1's Twilio refactor.
- No bulk PHI encryption of existing columns. That stays in Phase 3 as planned. New PHI-bearing columns introduced from Phase 1 onward will be encrypted at write time using the PR5 primitives.

**Exit criteria.** Phase 0 is done when all five PRs are merged to `main`, Sentry is receiving errors in production with no PHI in payloads (verified by a synthetic error test), and the `enrollment_jobs` table is being drained by cron on the production schedule.

---

## The 5 PRs

### PR1 — Replace fire-and-forget enrollment with a durable job queue

**Urgency.** Highest. This is an active bug, not a future risk.

**Problem.** Four handlers (`api/leads/route.ts:134`, `api/capture/[slug]/route.ts:90`, `api/consultations/route.ts:161`, `api/consultations/[id]/route.ts:112,138`) kick off `enrollContact(...).catch(console.error)` after returning the response. Vercel's serverless runtime may kill the function before the unawaited promise settles. Lead-automation enrollments are silently dropping today.

**Scope.**
- New table `enrollment_jobs (id uuid pk, organization_id uuid, contact_id uuid, trigger text, payload jsonb, status text, attempts int default 0, scheduled_at timestamptz default now(), processed_at timestamptz, error text, created_at timestamptz default now())`. Index `(status, scheduled_at)`.
- RLS: `org_isolation` policy using `current_org_id()` helper — same pattern as every other tenant table.
- Convert each of the 4 call sites to `INSERT INTO enrollment_jobs ...` inside the same transaction-ish boundary as the lead/contact write.
- Extend `/api/cron` to drain `enrollment_jobs WHERE status='pending' AND scheduled_at <= now()` with bounded concurrency and a retry-with-backoff policy capped at 5 attempts.
- Add structured logging (pre-PR3: use plain `console.log` with contact_id only — never email/phone).

**Acceptance.**
- Creating a lead writes a `pending` row to `enrollment_jobs`; the next `/api/cron` tick flips it to `processed` and writes the corresponding `contact_sequence_enrollments` row.
- Failure in `enrollContact` increments `attempts` and reschedules with backoff; after 5 attempts the row is `failed` and the error is captured.
- No regression: existing contacts already enrolled are unaffected.

**Migrations.**
- One new migration (ships in the existing `add-*.sql` style — reversible-migration restructure comes in Phase 1).

**New env vars.** None.

**Test plan.**
- Unit: job processor retries on thrown errors; backoff math correct; stops at max attempts.
- Integration: create a lead via `/api/leads` → a row exists in `enrollment_jobs`; run the cron processor → `contact_sequence_enrollments` row appears.
- Idempotency: processing the same job twice does not produce duplicate enrollments (leverages the existing unique partial index `enrollments_one_active_idx`).

**Rollback.** Drop the new insert paths, re-enable fire-and-forget calls, then drop the table. The table is write-only new state — no existing data to preserve.

**Effort.** ~1 day.

---

### PR2 — `.env.example` + pre-commit check

**Urgency.** Low-effort hygiene. Ship early because it's cheap and every later PR benefits.

**Scope.**
- Enumerate every `process.env.FOO` reference in `src/`. Produce `.env.example` at repo root with placeholder values and a one-line comment per variable (what it's for, which integration).
- Add a pre-commit check (script in `.husky/pre-commit` or a `scripts/check-env.sh`) that fails the commit if a `process.env.NEW_VAR` appears in staged files without a corresponding entry in `.env.example`. Start as a **warning** for the first week, then flip to **error** (via a config flag).

**Acceptance.**
- A fresh clone lists every required secret from `.env.example`.
- Committing a new `process.env.FOO` without updating `.env.example` surfaces a warning/error.

**Migrations.** None.

**New env vars.** `.env.example` documents **all existing** vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`.

**Test plan.** The pre-commit script is the test. Manually verify that a dummy `process.env.FOO_TEST_VAR` reference triggers it.

**Rollback.** Delete the file and the pre-commit hook. Zero runtime impact.

**Effort.** ~0.5 day.

---

### PR3 — PHI-safe structured logger

**Urgency.** High. Gate for PR4 and for every future PHI-bearing feature.

**Scope.**
- New module `src/lib/log.ts` exporting `log.info`, `log.warn`, `log.error` with signature `(message: string, context?: Record<string, unknown>, error?: unknown)`.
- Serializer enforces a deny-list: keys `email`, `phone`, `first_name`, `last_name`, `full_name`, `body`, `notes`, `date_of_birth`, `procedure_interest`, `to_address`, `to_number`, `intake_answers` are replaced with `<redacted:KEYNAME>` at any depth. Applies to raw Error objects (stringified via `err.message` + `err.stack`, which are scanned for the same keys).
- Every error payload is always reduced to `{ message, name, correlationId, resourceType, resourceId }`. The raw `err` object never escapes the serializer.
- Replace the three known leak sites from AUDIT §6:
  - `src/lib/automation-engine.ts:107` (`console.error('Error processing enrollment step:', err)`)
  - `src/lib/consultation-reminders.ts:196` (`console.error('[sms] ${type} FAILED...', err?.message)`)
  - `src/app/api/demo/route.ts:150` (`JSON.stringify(emailErr)`)
- Grep for remaining `console.log`/`console.error` in `src/` and migrate them to the logger. Add an ESLint rule (`no-console: error` in `src/`, allowed in `scripts/`) to prevent regression.

**Acceptance.**
- Calling `log.error('context', { contact: { email: 'x@y.com', phone: '555', first_name: 'Ana' } })` produces an output line containing `<redacted:email>`, `<redacted:phone>`, `<redacted:first_name>` — never the raw values.
- `grep -r "console\." src/` returns zero results outside `src/lib/log.ts`.
- ESLint blocks new `console.*` calls in `src/`.

**Migrations.** None.

**New env vars.** `LOG_LEVEL` (default `info`; `debug` in dev).

**Test plan.**
- Unit: feed every deny-listed key (top-level and nested); assert replacement.
- Unit: feed an `Error` whose `.message` contains a seeded email; assert redaction.
- Unit: serializer error fallback returns a plain message instead of crashing.

**Rollback.** Revert to plain `console.*`. Logger file can stay as unused.

**Effort.** ~1 day (includes sweeping non-obvious `console.*` call sites).

---

### PR4 — Sentry wired through the PHI-safe logger + integration kill-switch flags

**Urgency.** High. Your first lens into production errors. Must land after PR3.

**Scope.**
- Install `@sentry/nextjs`. Wire server-side init in `sentry.server.config.ts` and client in `sentry.client.config.ts`. Route source maps uploaded during build.
- `beforeSend` hook runs every event through the PR3 serializer. Request bodies, URL query strings, and breadcrumbs are scrubbed with the same deny-list.
- `Sentry.captureException(err, { extra: { correlationId, resourceType, resourceId } })` wired into `log.error`.
- Add **integration kill-switch env vars** here (cheap to bundle): `INTEGRATION_STRIPE_ENABLED`, `INTEGRATION_TWILIO_ENABLED`, `INTEGRATION_RESEND_ENABLED` — default `true`. Wrap the three existing client call sites with `if (flag === 'false') return { skipped: true }`. **Retries and timeouts are NOT in this PR** — they land with Phase 1's Twilio refactor, per ROADMAP.
- Sample rate: `tracesSampleRate: 0.1` to start. Error events: 100%.

**Acceptance.**
- Throwing in a staging route surfaces the event in Sentry within 30s.
- The Sentry event body contains no deny-listed keys. Verify with a synthetic test: deploy a `/api/debug/phi-test` route (behind a flag) that throws with a PHI-laden payload, confirm Sentry shows redacted values, then remove the route.
- Setting `INTEGRATION_TWILIO_ENABLED=false` in staging causes `sendSMS` to return `{ skipped: true }` — no Twilio HTTP call is made.

**Migrations.** None.

**New env vars.** `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` (build-time for source maps), `INTEGRATION_STRIPE_ENABLED`, `INTEGRATION_TWILIO_ENABLED`, `INTEGRATION_RESEND_ENABLED`. All added to `.env.example` in the same PR.

**Test plan.**
- Unit: `beforeSend` serializer — same tests as PR3, re-used.
- Unit: kill-switch behavior for each integration.
- Manual/staging: synthetic PHI-laden error produces redacted Sentry event.

**Rollback.** Remove Sentry deps and config files. Kill-switch flags can stay unused (they default to on).

**Effort.** ~1 day.

---

### PR5 — pgcrypto primitives + `docs/VENDOR_BAA.md`

**Urgency.** Medium. No runtime change, but lands cheaply and unblocks encrypted credential storage for Phase 1 and onward.

**Scope.**
- Migration: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`. Safe on Supabase — already available in their managed Postgres.
- New module `src/lib/crypt.ts` exposing `encrypt(plaintext: string): Buffer` and `decrypt(ciphertext: Buffer): string`. Uses `pgp_sym_encrypt`/`pgp_sym_decrypt` server-side via a Supabase RPC, keyed by `ENCRYPTION_KEY` with a `key_version` column convention for future rotation.
- No existing columns are encrypted in this PR. The helper is library-only.
- Document in `docs/ENCRYPTION.md` (one page): how to add an encrypted column, how to rotate keys, when to use it vs. leaving plaintext.
- New `docs/VENDOR_BAA.md` enumerating every vendor that touches PHI (Supabase, Stripe, Twilio, Resend, Sentry [added in PR4], and placeholders for Meta/OpenAI/Google Calendar coming in later phases). Columns: `Vendor | PHI touched | BAA status | Signed date | Renewal date | Notes`. BAA status fills from out-of-band confirmation — this PR establishes the document, not the contracts.

**Acceptance.**
- `encrypt(s)` → `decrypt(result)` round-trips to `s` in a unit test.
- Wrong key produces a clean error, not a stack-trace dump.
- `docs/VENDOR_BAA.md` exists with all current vendors listed. BAA status can be `signed`, `pending`, `not-applicable`, or `unknown`.

**Migrations.**
- One new migration enabling pgcrypto. Reversible: `DROP EXTENSION IF EXISTS pgcrypto;` in the down migration (only runs if nothing else depends on it — safe because no columns use it yet).

**New env vars.** `ENCRYPTION_KEY` (32-byte base64), `ENCRYPTION_KEY_VERSION` (default `1`).

**Test plan.**
- Unit: round-trip, wrong-key error, empty-string handling, UTF-8 handling.
- No integration test needed — nothing in the app uses it yet. First consumer is Phase 1 PR #1.

**Rollback.** Revert the module; drop the extension. Zero app-level state change.

**Effort.** ~0.5–1 day.

---

## Execution order

**Recommended sequential order (solo engineer):**

```
Day 1: PR1 — fire-and-forget fix
Day 2 AM: PR2 — .env.example
Day 2 PM → Day 3: PR3 — PHI-safe logger
Day 4: PR4 — Sentry + kill-switch flags
Day 5: PR5 — pgcrypto + BAA doc
```

**If two engineers in parallel:**

- Engineer A: PR1 → PR3 → PR4 (the critical dependency chain).
- Engineer B: PR2 → PR5 (independent).

---

## Effort per PR

| PR | Title | Effort |
|---|---|---|
| PR1 | Fire-and-forget fix + `enrollment_jobs` | ~1 day |
| PR2 | `.env.example` + pre-commit | ~0.5 day |
| PR3 | PHI-safe structured logger | ~1 day |
| PR4 | Sentry + kill-switch flags | ~1 day |
| PR5 | pgcrypto primitives + BAA doc | ~0.5–1 day |
| **Total** | | **~4–5 days** |

---

## Dependencies between PRs

```
PR1 (enrollment fix)   ── independent ──┐
                                        │
PR2 (.env.example)     ── independent ──┼── to Phase 1
                                        │
PR3 (PHI-safe logger)  ───►  PR4 (Sentry uses beforeSend from PR3)
                                        │
PR5 (pgcrypto + BAA)   ── independent ──┘
```

**Hard dependency:** PR4 requires PR3 to be merged. Shipping PR4 before PR3 means the first production error leaks PHI to a third-party service.

**Soft dependencies (nice-to-have order, not required):**
- PR2 before PR4 and PR5 so those two PRs have a pre-existing `.env.example` file to append to (cleaner diffs).
- PR5 before Phase 1 begins (so Twilio credentials encrypt on first write).
- PR1 before Phase 1 begins (so Phase 1 doesn't add more fire-and-forget call sites onto broken foundations).

---

## Safe ship plan (without breaking live product)

### PR1 — ship with dual-write for one deploy

The risk is that the new cron processor has a bug and enrollments stop flowing entirely, a harder failure than today's silent-drop bug.

1. Deploy to staging. Create 3 test leads. Verify `enrollment_jobs` rows are drained on the next cron tick.
2. Deploy to production **with the old fire-and-forget call left in place** behind a flag (`ENROLLMENT_JOBS_MODE=shadow`). In shadow mode, both the old path and the new path run — the jobs table gets written to, but the legacy `.catch(console.error)` path also executes. Because both paths funnel through the same unique partial index on `contact_sequence_enrollments`, duplicates are impossible.
3. Monitor for 24h. If `enrollment_jobs` drains cleanly, flip `ENROLLMENT_JOBS_MODE=primary` to disable the legacy path.
4. Remove the flag and the legacy code in a small follow-up PR after 48h of clean production signal.

### PR2 — ship as warning first

1. Deploy `.env.example` and the pre-commit hook in **warning** mode (logs but doesn't block).
2. After a week with zero violations, flip to **error** mode.
3. Zero runtime risk at either stage — this is a dev-environment concern.

### PR3 — ship with the serializer error-fallback

The risk is that a malformed input crashes the serializer and a route throws 500.

1. The serializer wraps its work in `try/catch`; on any internal error it falls back to `String(input).slice(0, 500)` rather than throwing.
2. Deploy to staging, run the existing app flows, confirm no regression in server logs (stdout).
3. Deploy to production. Watch for 2 hours before moving on to PR4.

### PR4 — ship with low sample rate and a synthetic PHI test

The risk is a Sentry config mistake that either (a) never fires, or (b) fires with PHI in the payload.

1. Deploy to staging with `tracesSampleRate: 0.1`.
2. Trigger the synthetic error endpoint `/api/debug/phi-test` (flag-gated, non-public). Verify in the Sentry UI that the event shows `<redacted:email>` etc.
3. Remove the synthetic endpoint in the same PR before merging (or gate it behind `NODE_ENV !== 'production'`).
4. Deploy to production. Tail Sentry for the first hour — confirm event volume is sane and no PHI appears.
5. Kill-switch flags default to `true` — no existing call sites change behavior. Verifying the flag is done via a **staging-only** manual flip to `false`.

### PR5 — ship the extension, do not touch data

The risk is trivial: pgcrypto is already available on Supabase; the migration only installs the extension.

1. Run the migration on staging. Run the round-trip unit test.
2. Run the migration on production. No app-level behavior changes because no column uses the helper yet.
3. `docs/VENDOR_BAA.md` is pure markdown — zero deployment risk.

### Cross-PR safety rules

- **No PR in Phase 0 adds a user-facing feature.** If a reviewer notices feature drift, reject the PR.
- **Every PR is revertable in one commit.** No coupled migrations across PRs (PR1's migration and PR5's migration are independent).
- **Deploy one PR at a time, wait at least 2 hours between deploys.** The point is to isolate blame if Sentry starts screaming.
- **Don't start Phase 1 until all five PRs are merged and Phase 0 exit criteria are met.**

---

## Open questions to resolve before PR1 lands

1. **Cron cadence.** Today `/api/cron` is triggered by an out-of-repo scheduler (AUDIT §4.1 — `vercel.json` not present). What's the cadence? PR1's retry backoff assumes at least 1 tick per 5 minutes. If it's hourly, the backoff policy needs to be adjusted.
2. **`ENCRYPTION_KEY` storage.** Vercel env var is fine for staging. For production, confirm whether you want plain Vercel env (simple) or KMS-wrapped (safer, more work). PR5 assumes plain env var with a comment pointing to KMS as a follow-up.
3. **Sentry plan.** The free Developer plan works for V1. If you expect >5k events/month, budget for Team ($26/mo).

_End of plan. No code changes until all five PRs are approved for execution._
