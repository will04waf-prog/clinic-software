# Multi-Clinic Phone Infrastructure — Operator Runbook

This runbook covers everything an operator needs to go from a fresh
Twilio + Stripe + Vercel deployment to a live per-clinic phone-number
provisioning pipeline (Phase 5 M1–M7).

The architecture in one paragraph: each organization owns a dedicated
Twilio phone number, registered against its own A2P 10DLC brand and
campaign, with the inbound side bound to a Vapi assistant. Provisioning
is driven by the durable `provisioning_jobs` queue (M1) and the
`/api/cron/provisioning` runner (M5). A2P approval is polled by
`/api/cron/a2p-status` (M4). Per-minute voice + per-segment SMS usage
is recorded into `usage_events` and flushed nightly to Stripe via
`/api/cron/report-usage` (M7). Owners onboard themselves via
`/onboarding/phone-number` (M3); operators monitor and recover from
`/admin/numbers` (M6).

---

## 1. Twilio Trust Hub — one-time setup (per Twilio account)

Trust Hub is the gateway every A2P 10DLC brand registration is routed
through. The Primary Customer Profile lives at the Twilio-account
level and is shared across every clinic; each clinic gets its own
Secondary Customer Profile + Brand + Campaign minted via the API in
M4.

1. Log in to <https://console.twilio.com> with the Tarhunna ops
   account. Switch to the production sub-account if you maintain a
   sandbox.
2. Navigate to **Trust Hub → Primary Customer Profile**.
3. Click **Create new profile** and complete the wizard:
   - Business legal name: the legal entity that owns Tarhunna (NOT
     the d/b/a). Must match IRS records.
   - Business type: usually **Limited Liability Corporation**.
   - Business industry: **HEALTHCARE** is acceptable as the
     parent-ISV industry even though Tarhunna itself is a SaaS — the
     end-clinic per-secondary-CP industry is what carriers gate on.
   - Business registration type: **EIN**.
   - Business registration number: Tarhunna's federal EIN.
   - Authorized representative: a real human at Tarhunna who Twilio
     can call/email for compliance verification. Carriers do
     occasionally call.
4. Submit. The Primary Customer Profile typically takes 1–3 business
   days to land in **TWILIO_APPROVED**. Until it's approved, the M5
   queue's A2P steps will fail loudly with a status string the admin
   dashboard surfaces verbatim.
5. Once approved, no further Trust Hub UI work is needed — the
   Secondary CP, TrustProduct, Brand, and Campaign for each clinic
   are all created via the API by the M5 queue handlers (see
   `src/lib/telephony/a2p.ts`).

The Secondary CP and A2P TrustProduct policy SIDs are stable Twilio
constants and are hardcoded in `src/lib/telephony/a2p.ts`. If Twilio
ever publishes new policy SIDs, override via the optional env vars
`TWILIO_TRUSTHUB_SECONDARY_PROFILE_POLICY_SID` and
`TWILIO_TRUSTHUB_A2P_POLICY_SID`.

---

## 2. Stripe metered Price IDs (one-time, in the Stripe Dashboard)

The metered billing reporter (`/api/cron/report-usage`) writes meter
events against three Stripe Prices. Each Price MUST be backed by a
Stripe Meter that listens for the matching `event_name`.

### 2a. Create the three Meters first

In the Stripe Dashboard go to **Billing → Meters** → **Create meter**
and create one per kind:

| Meter display name | `event_name` (case-sensitive) | aggregation |
| --- | --- | --- |
| Phone numbers | `phone_number_rent` | `sum` |
| Voice minutes | `voice_minute` | `sum` |
| SMS segments | `sms_segment` | `sum` |

Aggregation key: `value` (default). Customer mapping: by
`stripe_customer_id`. Save each meter.

### 2b. Create the three Prices

For each meter, create a Product first if one doesn't already exist
(**Products → Add product**). Recommended names: "Per-clinic phone
number", "Voice minutes (overage)", "SMS segments (overage)".

Then under each Product → **Add price** and use these exact field
values:

| Field | Value |
| --- | --- |
| Pricing model | Standard pricing |
| Billing scheme | `per_unit` |
| Usage type | `metered` |
| Aggregate usage | `sum` |
| Recurring | Monthly |
| Meter | Bind to the meter you created in 2a |
| Unit amount | (your pricing decision — start at $2.00 / number, $0.05 / voice minute, $0.01 / SMS segment) |
| Currency | USD |

Save each price. Copy the `price_…` IDs out — these go into Vercel
env vars in step 3.

### 2c. Add the prices to each subscription

For existing customer subscriptions, you must add each metered price
as a new subscription item. New subscriptions created via the
`/api/billing/checkout` flow will need to be updated to include the
three metered items as well — that update is OUT OF SCOPE of this
runbook and tracked in the Phase 5 backlog.

---

## 3. Vercel environment variables

In **Vercel → Tarhunna project → Settings → Environment Variables**,
add the following under the Production scope (and Preview if you
want to dry-run there):

| Name | Value |
| --- | --- |
| `STRIPE_PHONE_NUMBER_PRICE_ID` | `price_…` from step 2b |
| `STRIPE_VOICE_OVERAGE_PRICE_ID` | `price_…` from step 2b |
| `STRIPE_SMS_OVERAGE_PRICE_ID` | `price_…` from step 2b |
| `STRIPE_PRICE_PHONE_NUMBER_RENT` | Alias of the above (for new code) |
| `STRIPE_PRICE_VOICE_MINUTES_OVERAGE` | Alias of the above (for new code) |
| `STRIPE_PRICE_SMS_OVERAGE` | Alias of the above (for new code) |
| `A2P_REQUIRED` | `true` once carriers start filtering — leave `false` while clinics are mid-registration. |
| `A2P_SMS_BLOCK_ENABLED` | Alias of `A2P_REQUIRED`. |
| `METERED_USAGE_ENABLED` | `true` after 30 days of usage data are in `usage_events`. |
| `PROVISIONING_RETRY_MAX` | Leave unset (default 5) unless an outage requires manual fan-out. |
| `TWILIO_DEFAULT_COUNTRY` | `US` (default). Set to a different ISO-3166-1 alpha-2 only for non-US deploys. |

The Twilio + Vapi + Supabase env vars from the baseline `.env.example`
must already be set; M1–M7 do not add new credentials, only feature
flags and Stripe Price IDs.

Redeploy after adding env vars (Vercel does not hot-reload them into
existing serverless functions).

---

## 4. First-clinic provisioning walkthrough

### Clinic #1 (operator-driven via CLI)

The first clinic is intentionally provisioned manually so the operator
can eyeball each step before the cron queue takes over for clinic #2+.

1. The clinic owner signs up + completes the procedure picker. Their
   org now has a `call_agent_assistant_id` (seeded by
   `scripts/seed-vapi-assistant.ts` when their org row was created).
2. Buy the Twilio number manually in the Twilio Console (Phone Numbers
   → Buy a Number). Pick the area code the clinic asked for. The
   number lands in `IncomingPhoneNumbers` on the production sub-
   account.
3. Run the rescue script from the repo root:

   ```bash
   npx tsx scripts/provision-clinic-phone.ts <org-id> <e164>
   ```

   The script verifies the number is on the account, registers it
   with Vapi (catching the 409 dup-recover path), and stamps
   `organizations.vapi_phone_number_id` + `twilio_phone_sid` +
   `phone_number_purchased_at`.
4. The owner now visits `/onboarding/phone-number` to fill out the
   A2P brand form (business legal name, EIN, authorized rep,
   address). Submitting the form enqueues the
   `a2p_brand_register` step in `provisioning_jobs`.
5. The next `/api/cron/provisioning` tick (within a minute) picks up
   the job, calls TrustHub, stamps `a2p_brand_sid` + `a2p_status =
   'pending'`, and enqueues `a2p_campaign_register`.
6. `/api/cron/a2p-status` polls the brand every 30 minutes. Approval
   typically takes 1–7 business days. On approval, the cron flips
   `a2p_status = 'approved'`, fires the owner notification email,
   and SMS becomes deliverable.

### Clinic #2+ (self-serve via onboarding UI)

After the first clinic is live and the operator is confident in the
flow, the entire pipeline runs without manual intervention:

1. Owner signs up, completes the procedure picker.
2. Owner clicks the yellow banner on `/dashboard` → lands on
   `/onboarding/phone-number`.
3. Owner searches available numbers (Twilio AvailablePhoneNumbers
   API via `src/lib/telephony/twilio-numbers.ts`), picks one,
   and submits.
4. The submit enqueues the `twilio_buy` step. The M5 cron runner
   buys the number, registers it with Vapi, stamps the org, and
   continues to A2P brand registration once the owner fills out
   the brand form on the same page.
5. The `/admin/numbers` dashboard surfaces the row as **PENDING**
   until A2P approval, then **HEALTHY**.

---

## 5. Health dashboard — `/admin/numbers`

This is the super-admin's at-a-glance view of every clinic's phone
infrastructure. Each row shows: clinic name, assigned E.164, A2P
4-state badge, Vapi binding state, last inbound / last outbound call
timestamps, 30-day call + SMS counts, and a re-trigger button on
broken rows.

### Filter chips

The filter chips along the top scope the visible rows. Counts on each
chip are computed BEFORE filtering, so the totals don't change as you
click.

| Chip | Meaning |
| --- | --- |
| **All** | Every org with a row in `organizations` (default). |
| **Healthy** | `vapi_phone_number_id` set AND `a2p_status='approved'` AND ≥1 `call_logs` row in the last 30 days. |
| **Pending** | Any `provisioning_jobs` row in `pending` or `in_progress`. Takes precedence over Broken — don't re-trigger while the queue is reconciling. |
| **Broken** | `a2p_status='rejected'` OR (no `vapi_phone_number_id` AND `voice_reminder_enabled=true`) OR stale (no `call_logs` rows in 7 days while reminders are enabled). |
| **No number** | Owners who haven't completed `/onboarding/phone-number` yet. These don't need ops attention unless they're trying to send SMS. |

### Re-trigger button

On any row that filtered into Broken, a **Re-trigger** button enqueues
the right provisioning step based on the failure mode (see
`src/app/admin/numbers/actions.ts`). The button is a no-op (silent
success) if a `pending` or `in_progress` job already exists for that
org+step.

---

## 6. Common failure modes + recovery

### a) Twilio number purchase fails

**Symptom:** A row stuck on `provisioning_jobs.step = 'twilio_buy'`
with `status = 'failed'` and `last_error` containing a Twilio error
code.

| Twilio code | Meaning | Recovery |
| --- | --- | --- |
| 20003 | Auth failure | Re-check `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` in Vercel env. |
| 21422 | PhoneNumber invalid | The owner picked a number that was bought by someone else between search and submit. Reset `provisioning_jobs.status` to `pending` so the owner re-searches. |
| 21452 | No numbers available | The area code is exhausted. Tell the owner to pick a nearby area code. |
| 20429 | Rate limit | Wait 60s and click **Re-trigger** on `/admin/numbers`. |

Generic recovery: in the Twilio Console, confirm the number is NOT
already on your `IncomingPhoneNumbers` list. If it is (the buy
succeeded but the DB write didn't), use
`scripts/provision-clinic-phone.ts <org-id> <e164>` to stitch the
existing number back into the org row — the script is idempotent on
Twilio's side and will skip the buy.

### b) A2P brand rejection

**Symptom:** `organizations.a2p_status = 'failed'` after the
`/api/cron/a2p-status` cron polls a rejected brand. The owner gets a
rejection notification email; the operator gets a row in the Broken
bucket on `/admin/numbers`.

Look up the rejection reason in `activity_log` filtered to
`action = 'a2p_brand_rejected'`. Common reasons:

- **EIN mismatch:** the EIN the owner entered doesn't match the IRS
  record for the business legal name. Recovery: ask the owner to
  correct the legal name OR confirm the EIN, then clear
  `a2p_brand_sid` + `a2p_status` on the org row and re-enqueue
  `a2p_brand_register`.
- **Website unreachable:** the `website_url` 404s from carrier-side
  crawlers. Recovery: ask the owner for a live URL with the
  business address on the homepage.
- **Authorized representative unverifiable:** carriers couldn't
  reach the rep at the supplied phone number. Recovery: update the
  rep contact info, then re-enqueue.

To re-submit after fixing the brand data, the operator must clear
`organizations.a2p_brand_sid` and `a2p_status`, then re-enqueue
`a2p_brand_register` (the **Re-trigger** button does this in one
click). The TrustHub-side rejected row is left in place; Twilio
allows multiple Brand submissions per Secondary Customer Profile.

### c) Vapi 409 on phone-number registration

**Symptom:** `provisioning_jobs.step = 'vapi_register'` row with
`last_error` containing `409` or `already_exists`.

Vapi's `POST /phone-number` is NOT idempotent — if the number was
registered in a prior tick that crashed between the Vapi POST and the
DB write, the second attempt fails with 409. The M5 step handler
catches this and recovers via `GET /phone-number?number=<e164>`,
stamping the existing Vapi `id` back onto the org. If you're seeing
this surface as a real failure, it means the recovery branch itself
errored.

Recovery:
1. Look up the number in the Vapi dashboard
   (<https://dashboard.vapi.ai/phone-numbers>). Confirm it exists and
   the `id` matches what's on the org row.
2. If the org row has `vapi_phone_number_id = NULL` but Vapi DOES
   have the number, set the column manually:

   ```sql
   UPDATE organizations
   SET vapi_phone_number_id = '<vapi-id>'
   WHERE id = '<org-id>';
   ```

   Then mark the queue row complete:

   ```sql
   UPDATE provisioning_jobs
   SET status = 'succeeded', completed_at = now()
   WHERE organization_id = '<org-id>' AND step = 'vapi_register';
   ```

3. Click **Re-trigger** for the next step (`a2p_brand_register`) on
   `/admin/numbers`.

### d) Provisioning job stuck in `in_progress`

**Symptom:** A row in `provisioning_jobs` with
`status = 'in_progress'` and `claimed_at` more than 5 minutes old.
This means a previous tick claimed the row, then crashed before
calling `complete()` or `fail()`.

Recovery: the `claim()` function in `src/lib/provisioning/queue.ts`
includes a stale-claim timeout that re-eligibles rows held longer
than 5 minutes, so usually the next tick recovers automatically. If
it doesn't, manually reset:

```sql
UPDATE provisioning_jobs
SET status = 'pending', claimed_at = NULL, last_error = 'manual-reset-after-stall'
WHERE id = '<row-id>';
```

### e) Metered usage flowing locally but not landing in Stripe

**Symptom:** `usage_events` rows have `reported_to_stripe_at = NULL`
after 24 hours.

Causes (in order of likelihood):

1. `METERED_USAGE_ENABLED` is `false` (default) — flip to `true`.
2. The matching `STRIPE_*_PRICE_ID` env var is unset — the cron
   per-kind no-ops with a console warning.
3. The org's `stripe_customer_id` is NULL — Stripe meter events
   require a customer. Check the org row.
4. The Stripe Meter `event_name` doesn't match the kind (typo in
   the dashboard). Each meter must listen for `voice_minute`,
   `sms_segment`, or `phone_number_rent` exactly.

Manual flush after fixing: `curl -X POST -H "Authorization: Bearer
$CRON_SECRET" https://tarhunna.net/api/cron/report-usage`.

---

## 7. Quick reference — what each cron does

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron` | every minute | Existing fan-out (reminders, follow-ups, etc.) |
| `/api/cron/voice-reminders` | hourly | Existing voice-reminder dispatcher |
| `/api/cron/voice-reminder-staleness` | every 30 min | Existing staleness sweep |
| `/api/cron/provisioning` | every minute | M5 — drains `provisioning_jobs` |
| `/api/cron/a2p-status` | every 30 min | M4 — polls Twilio for brand status |
| `/api/cron/report-usage` | daily 02:00 UTC | M7 — flushes `usage_events` to Stripe |

All cron routes require `Authorization: Bearer ${CRON_SECRET}` when
the env var is set. GET aliases POST on each route for manual
operator triggering.
