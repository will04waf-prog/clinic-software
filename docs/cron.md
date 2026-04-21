# /api/cron

The single cron endpoint that drives all scheduled work in Tarhunna.

## What it does

`POST /api/cron` (GET delegates to POST) runs five jobs in parallel on every tick:

1. **processDueSteps** (`src/lib/automation-engine.ts`) — advances contacts through automation sequences, sending SMS/email when the next step is due.
2. **sendConsultationReminders** (`src/lib/consultation-reminders.ts`) — sends 24h and 2h SMS+email reminders for scheduled consultations.
3. **expireTrials** (`src/lib/expire-trials.ts`) — flips org `plan_status` from `trial` → `trial_expired` when `trial_ends_at` passes.
4. **sendTrialReminders** (`src/lib/trial-reminders.ts`) — sends 7d/3d/1d trial-ending reminders and the post-expiry email to org owners.
5. **processEnrollmentJobs** (`src/lib/enrollment-jobs.ts`) — drains the `enrollment_jobs` queue, calling `enrollContact` for each job.

## Scheduling

Vercel Crons, configured in `vercel.json` at the repo root:

```json
{ "crons": [ { "path": "/api/cron", "schedule": "* * * * *" } ] }
```

Every minute, production only. Registered automatically on each deploy.

## Authentication

Guarded by the `CRON_SECRET` env var (required in prod). Vercel Crons sends `Authorization: Bearer ${CRON_SECRET}` on each invocation, which the handler verifies. If `CRON_SECRET` is unset, the endpoint is open — only acceptable for local dev.

## Manual invocation (debugging)

```
curl -sS -H "Authorization: Bearer $CRON_SECRET" https://www.tarhunna.net/api/cron
```

Returns:

```json
{
  "ok": true,
  "ran_at": "2026-04-21T01:41:49.298Z",
  "enrollment_jobs": { "picked": 1, "processed": 1, "failed": 0 }
}
```

## Verification

**Is it running?** Vercel Dashboard → Logs → filter `/api/cron`. Should see one invocation every ~60s.

**Is the queue draining?**

```sql
select status, count(*) from public.enrollment_jobs group by status;
```

Expect `processed` growing, `failed` at zero, `pending` oscillating near zero.

## Emergency pause

Two options, either works:

1. **Remove the entry from `vercel.json`** and redeploy. Vercel Crons unregisters.
2. **Vercel Dashboard → Settings → Cron Jobs → disable** the `/api/cron` entry. Takes effect on next tick.

## Known limitations

- **Coarse serialization, not atomic claim.** `processDueSteps` and `sendConsultationReminders` are wrapped in a lock-table gate (`public.cron_locks` + `try_cron_lock` / `release_cron_lock` RPCs, TTL=90s). This prevents two concurrent ticks from both entering the same function body. It does NOT prevent the intra-function race: if a send succeeds but the corresponding row-update fails, the next tick can re-select and re-send. Full fix requires a row-level atomic claim — tracked as **PR-FU-1** (`processDueSteps`) and **PR-FU-2** (`sendConsultationReminders`). Until those ship, a send failure mid-tick results in a lost send (no retry), which is preferable to a double send.
- **Crash recovery delay.** If a cron tick crashes before releasing its lock, the lock sits until its TTL (90s) expires. The next tick is a no-op until then.
- **`sendTrialReminders` has a weak idempotency guarantee.** The `sent_at IS NULL` filter correctly excludes previously-sent orgs on subsequent ticks, but a crash between `sendEmail()` and the flag-update could duplicate the email to the org owner. Blast radius is small (internal customer, one email) so this is not currently wrapped. Upgrade to atomic-claim if trial volume grows.
- **Advisory locks considered and rejected.** PostgreSQL's session-scoped `pg_try_advisory_lock` does not work cleanly over Supabase's Supavisor pooler — acquire and release calls land on different pooled connections, leaking the lock on the originator. The lock-table pattern is functionally equivalent and correct under pooling.

## Lock key registry

Keep in sync with `supabase/migrations/20260421042333_add_cron_locks.sql`:

| Key                           | Function                                  |
|-------------------------------|-------------------------------------------|
| `processDueSteps`             | `src/lib/automation-engine.ts`            |
| `sendConsultationReminders`   | `src/lib/consultation-reminders.ts`       |
