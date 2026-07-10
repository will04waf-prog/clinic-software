# Multi-vertical (trades + bilingual + WhatsApp) — manual test & rollout

Phases 1–4 built the trades/bilingual/WhatsApp expansion. This is the
Phase 5 rollout: environment accounting, the deploy path, a seed/teardown
for a callable test tenant, and the manual checklist — ending with the
sales-demo path.

---

## 0. Environment accounting (READ FIRST)

**Every migration this session was applied directly to PRODUCTION.**

- Migrations `20260723…` (vertical config), `20260724…` (call language),
  `20260725…` (call urgency) were applied to Supabase project
  **`rvoxqjpqbchjdizdhajb`** — confirmed to be the same project the live
  app uses (`vercel env pull --environment=production` →
  `NEXT_PUBLIC_SUPABASE_URL` = `rvoxqjpqbchjdizdhajb`). There is no
  separate staging/local database on the account.
- **The live app is unaffected.** Every column is additive with a
  safe default (`vertical='medspa'`, `caller_languages='{en}'`,
  `is_urgent=false`, etc.), and the currently-deployed code never
  references the new columns. Verified: all existing rows carry the
  defaults (10 orgs medspa/en/{en}/sms; 21 call_logs not-urgent, null
  language; 550 contacts null preferred_language).
- **The DB is currently AHEAD of the deployed code.** All Phase 1–4
  *code* is uncommitted on `main`'s working tree — nothing is committed,
  pushed, or deployed. None of the new behavior is live yet.

### Deploy path (to make the new code live)

1. **Branch + commit** the working tree (it's on `main` now):
   `git checkout -b feat/multivertical && git add -A src supabase docs && git commit`
2. **Merge + push** `main` → Vercel auto-builds & deploys (~90s).
   (Migrations are already applied, so no DB step at deploy.)
3. **Env vars** — none required for trades/bilingual (the Spanish voice
   defaults to Azure `es-MX-DaliaNeural` in code). WhatsApp stays OFF:
   leave `WHATSAPP_ENABLED` unset. Set later, only when Meta approves:
   `WHATSAPP_ENABLED=true`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WA_*_SID`.
4. **Re-seed the trades assistant AFTER deploy** (§2) — the assistant's
   tool URLs must point at the deployed routes (`flag-urgent` etc.), so
   seed only once they're live.

---

## 1. RLS (cross-tenant) — new columns

RLS is table-level; the new columns inherit each table's org-scoped
policies. Confirmed enabled on prod:

| table | rls_enabled | policies |
|---|---|---|
| organizations | true | 2 |
| call_logs | true | 1 |
| contacts | true | 1 |

**Manual cross-tenant check (do once, post-deploy):** log in as an
owner of org A; in the browser network tab confirm a `call_logs` /
`contacts` fetch returns only org A rows — `detected_language`,
`is_urgent`, `urgency_reason`, `preferred_language` on other orgs' rows
are never returned. (Unit tests mock Supabase and therefore bypass RLS,
so this must be checked against the real DB with a real login.)

---

## 2. Seed the callable test tenant

Reuses the spare toll-free **(855) 589-4238** (org `tarhunna-da8f83`,
id `b9b77026-bbf6-4272-b640-daff0639df70`) so nothing new is
provisioned. The seed repurposes that org into the trades test tenant
and the teardown restores it.

### 2a. Configure the tenant (SQL — safe to run now)

```sql
update public.organizations
set vertical             = 'trades',
    caller_languages     = '{en,es}',
    owner_language       = 'es',
    notification_channel = 'sms',
    owner_notify_e164    = '+13016736362',
    call_agent_enabled   = true,
    call_agent_baa_attested_at = coalesce(call_agent_baa_attested_at, now()),
    name                 = 'Rivera Landscaping (trades test)'
where id = 'b9b77026-bbf6-4272-b640-daff0639df70';
```

### 2b. Re-seed its assistant as trades + rebind the toll-free (AFTER deploy)

The assistant must be regenerated with the new code so it gets the
trades prompt, the Spanish voice, the bilingual directive, and
`flag_urgent`. Then point the toll-free's Vapi number at it.

```bash
# From the repo, with prod env available. Regenerate the org's inbound
# assistant (forceNew) using the deployed app URL for tool callbacks:
SEED_APP_URL=https://tarhunna.net npx tsx scripts/seed-vapi-assistant.ts b9b77026-bbf6-4272-b640-daff0639df70 --force

# Grab the new assistant id it stamped:
NEW_ASSISTANT=$(… psql/execute_sql: select call_agent_assistant_id from organizations where id='b9b77026-…')

# Rebind the toll-free Vapi number (id 9e4ed982-2756-466d-bef2-c9204acfd2cb) to it:
curl -s -X PATCH https://api.vapi.ai/phone-number/9e4ed982-2756-466d-bef2-c9204acfd2cb \
  -H "Authorization: Bearer $VAPI_API_KEY" -H "Content-Type: application/json" \
  -d "{\"assistantId\":\"$NEW_ASSISTANT\"}"
```

> If `scripts/seed-vapi-assistant.ts` doesn't accept an org-id arg,
> trigger the app's normal "get Layla a number / re-provision" flow for
> this org instead — same effect (ensureInboundAssistant, forceNew).

### 2c. Teardown (restore everything)

```sql
update public.organizations
set vertical='medspa', caller_languages='{en}', owner_language='en',
    notification_channel='sms', owner_notify_e164=null,
    name='tarhunna'
where id='b9b77026-bbf6-4272-b640-daff0639df70';
```
```bash
# Rebind the toll-free to its original assistant and delete the temp one:
curl -s -X PATCH https://api.vapi.ai/phone-number/9e4ed982-2756-466d-bef2-c9204acfd2cb \
  -H "Authorization: Bearer $VAPI_API_KEY" -H "Content-Type: application/json" \
  -d '{"assistantId":"4ed8d1df-c2f2-44a5-8ef9-1d6a09d69949"}'
curl -s -X DELETE https://api.vapi.ai/assistant/$NEW_ASSISTANT -H "Authorization: Bearer $VAPI_API_KEY"
```

---

## 3. Manual checklist

Run after deploy + §2. ☐ = to verify.

### A. Med-spa regression (must be unchanged)
- ☐ Call the med-spa demo line **(301) 962-2856** — English greeting,
  Savannah voice, books as before. No Spanish, no "job" wording.
- ☐ A med-spa call summary email to the owner is still English and
  **PHI-scrubbed** (no phone/date in the in-app summary).

### B. Bilingual handling (the test line, (855) 589-4238)
- ☐ Call in **English** → Layla answers and runs the whole call in
  English; talks in "jobs/technician", never "appointment/clinic".
- ☐ Call in **Spanish** → whole call in neutral Latin-American Spanish,
  "usted".
- ☐ **Code-switch mid-call** (start English, switch to Spanish) → Layla
  follows your most recent language, doesn't lock to the first.
- ☐ No language menu ever plays.

### C. Owner notifications — SMS path
- ☐ After a normal call, owner cell **+1 301-673-6362** gets a **Spanish**
  SMS (owner_language=es), PHI-free ("mensaje nuevo / Layla…").
- ☐ Confirm the summary language follows **owner_language**, not the
  call language (English call → still Spanish owner SMS).

### D. Urgency (trades only)
- ☐ In Spanish, say an emergency ("tengo una fuga de agua, es urgente").
  Layla flags it; owner gets an **immediate** Spanish SMS.
- ☐ Same in English ("burst pipe, it's flooding") → immediate alert.
- ☐ Confirm the alert **bypasses dedupe**: two urgent calls → two SMS.
- ☐ Confirm the 911 rail is untouched: a medical-emergency phrase still
  triggers the "hang up and dial 9-1-1" line, separately.
- ☐ In the CRM, the call shows `is_urgent = true` + the reason.

### E. WhatsApp — **BLOCKED (pending Meta template approval)**
`WHATSAPP_ENABLED` is off, so WhatsApp is never attempted. Verify the
**fallback** instead:
- ☐ Set the test tenant `notification_channel='whatsapp'` (SQL). With
  WhatsApp disabled, an owner alert must still arrive **via SMS**
  (fallback), never silent.
- ☐ Revert `notification_channel='sms'`.
- ☐ (Later, once Meta approves the 6 templates in `src/lib/notify/templates.ts`
  and the env is set) re-run C/D over WhatsApp and confirm the inbound
  `OK` reply opens the 24h freeform window.

---

## 4. ⭐ THE SALES DEMO — demo-critical path

This is the sequence that sells the product. Run it clean, in order.

1. **You call (855) 589-4238 in English.** Describe a normal job
   ("I need a quote for weekly lawn service"). ✅ Layla handles the
   entire call in English, in trades language.
2. **Your compadre calls (855) 589-4238 in Spanish**, and describes an
   **urgent** problem ("Hola, tengo una fuga de agua en la cocina, es
   urgente"). ✅ Layla handles the entire call in neutral Spanish,
   "usted", and flags it urgent.
3. **Within seconds, the owner cell +1 301-673-6362 receives a Spanish
   SMS** carrying the **caller's number** and the **stated issue**:
   > *URGENTE — Rivera Landscaping. Un cliente necesita que le
   > devuelvan la llamada ya. Problema: fuga de agua en la cocina.
   > Llámelo: +1 …(compadre's number)…*
   ✅ One tap on that number calls the customer back.

**Pass criteria:** English in → English out; Spanish in → Spanish out;
owner's Spanish SMS arrives immediately with a tappable caller number
and the issue. That's the whole pitch in ninety seconds.
