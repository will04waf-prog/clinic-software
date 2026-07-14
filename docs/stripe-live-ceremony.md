# Stripe live-mode ceremony — run before the FIRST real owner onboards

Status: **card rails are DORMANT in prod.** The code is live, but every card
surface gates on `connect_charges_enabled` (no org has it) and the two env
vars below are unset, so Connect onboarding and the $39 subscribe fail
gracefully (localized error, no crash). Cash/Zelle/check recording, invoices,
estimates, and the trial engine are Stripe-free and fully live.

Everything verified in TEST mode 2026-07-12 (fee exact at 1%, idempotent
reconcile, $0-due-today trial subscribe — see `crm-pivot` memory / commit
`d76c41e`). This ceremony recreates the two test-mode objects in LIVE mode
and flips prod on. **Trigger: founder says the first real owner is ready.**

Principle: **the live secret key never touches a local disk.** Do live-object
creation in the Stripe Dashboard (live mode), and paste secrets only into
Vercel env vars.

## 1. Verify platform activation (founder, dashboard)

- Stripe Dashboard → toggle **Live mode**. Confirm the platform account is
  activated (can process live charges; no outstanding requirements banner).
- If not activated: complete activation first (business details, bank).

## 2. Confirm Connect live settings (founder, dashboard) — CONFIRMED BLOCKER

> **Observed in prod 2026-07-13:** tapping "Activar cobros con tarjeta"
> failed with Stripe's "You must complete your platform profile"
> (dashboard.stripe.com/connect/accounts/overview) — i.e. prod runs a
> LIVE key and the live platform-profile questionnaire is NOT done yet.
> The app now shows a friendly Spanish "muy pronto" state instead of the
> raw error, but Connect stays unusable until this step is completed.

- Dashboard (live) → **Connect → Settings**:
  - Express accounts enabled; platform profile/questionnaire complete —
    including the **loss-liability acknowledgment** (we run DIRECT charges:
    disputes debit the connected account, then platform is backstop).
  - **Branding** set (name + icon) — this shows on hosted onboarding and
    Checkout for every owner.
- Note: the questionnaire's destination-charge lean is guidance-only; the
  direct-charge model is a locked founder decision (statement descriptor =
  owner's business name, all-in 3.9% + 30¢ literally true, 1% exact).

## 3. Create the live $39 Price (dashboard — no local key)

- Dashboard (live) → **Product catalog → Add product**:
  - Name: `Tarhunna` · Description: "Tarhunna — CRM en español para negocios
    de servicios. Plan mensual."
  - Price: **$39.00 USD / month**, recurring · **lookup_key: `crm_monthly_v1`**
- Copy the live price id (`price_…`).
- (Alternative if you prefer the script: `scripts/create-crm-price.ts` run
  with the live key in a throwaway shell env — but dashboard is preferred.)

## 4. Create the live Connect webhook endpoint (dashboard)

> **This endpoint is DORMANT in prod today (returns 503, secret unset).**
> Two live features depend on it and DO NOT WORK until this step is done:
> (1) the **card-payment webhook fallback** — if a paying customer's browser
> never returns to the success page, the invoice is settled here instead of
> staying unpaid forever; (2) **dispute evidence** — on a card dispute, the
> approved-estimate timestamp + IP are auto-attached as Stripe evidence
> (`buildDisputeEvidence`). Both are code-complete and test-verified; they
> only need this live endpoint + secret.
>
> **Completion-photo evidence (Phase 3):** when the disputed invoice's job
> has `job_photos`, the dispute handler should ALSO upload a completion
> photo to Stripe (`stripe.files.create`, purpose `dispute_evidence`) and
> pass its file id as `serviceDocFileId` to `buildDisputeEvidence` — it
> becomes `service_documentation` (proof the work was performed) alongside
> the approval record. The builder already accepts `serviceDocFileId` +
> `photoCount`; wiring the Stripe file upload into the live webhook handler
> is the remaining step.

- Dashboard (live) → **Developers → Webhooks → Add endpoint**:
  - URL: `https://tarhunna.net/api/webhooks/stripe-connect`
  - **Listen to: events on Connected accounts** (this is the Connect toggle)
  - Events (BOTH — the endpoint handles each):
    - `charge.dispute.created` → attaches approval-record dispute evidence
    - `checkout.session.completed` → the payment-settled fallback
- Reveal the **signing secret** (`whsec_…`) once — paste it straight into
  Vercel (step 5), nowhere else.

## 5. Flip the two Vercel env vars (Production)

- `STRIPE_PRICE_CRM_MONTHLY` = live price id from step 3
- `STRIPE_CONNECT_WEBHOOK_SECRET` = signing secret from step 4
- Sanity: `STRIPE_SECRET_KEY` in Vercel prod must be the **live** secret key
  (it's masked — verify mode by the dashboard's key prefix listing, not by
  pulling it). No publishable key needed for these rails (hosted Checkout
  only; nothing renders card fields client-side).
- Redeploy (any push to main, or Vercel → Redeploy).

## 6. Live smoke test (founder's own business, ~$1)

1. In a real org (founder-owned), Settings → **Activar cobros con tarjeta**
   → complete LIVE Express onboarding (real identity + real bank).
2. Create a $1.00 invoice on a test client with the founder's own cell.
3. Open the `/pagar` link, pay with a real card.
4. Verify: invoice → Pagada; payments ledger row `method=card` with
   `application_fee_cents = 1` (1%); Stripe (live) shows the application fee
   on the platform and the charge on the connected account with the OWNER's
   statement descriptor.
5. Refund from the connected account's dashboard view (Payments → refund).
   Note: the app ledger keeps the succeeded row (append-only); that's fine
   for a smoke test.
6. Webhooks: Dashboard → Webhooks → the endpoint should show the delivery
   attempts (if any events fired) as 200s; a missing secret would 503
   (fail-closed) — that means step 5 was skipped.

## Dormant-state behaviors until the ceremony runs

- Settings → "Activar cobros con tarjeta" → Stripe error → localized error
  text on the card. (Live Connect not enabled / env absent.)
- Settings → "Suscribirse — $39/mes" → 500 from missing
  `STRIPE_PRICE_CRM_MONTHLY` → localized error text on the card.
- Public `/pagar/[token]` for any invoice → "Los cobros con tarjeta no están
  disponibles" (no org has `connect_charges_enabled`).
- `/api/webhooks/stripe-connect` → 503 fail-closed (secret unset). Correct.
