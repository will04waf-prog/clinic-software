# Phase 5 W1 — Voice Phone Twin (owner runbook)

This is the operational guide for getting the call agent live for a
single clinic. There's no automated provisioning yet — every step is
a one-time manual config per clinic.

## Prerequisites

1. **Vapi account** — vapi.ai. Get `VAPI_API_KEY` and a webhook
   secret. Drop both as Vercel env vars: `VAPI_API_KEY`,
   `VAPI_WEBHOOK_SECRET`.
2. **Vapi BAA signed** — required by HIPAA before any real patient
   call routes through the agent. Vapi BAAs flow down to OpenAI,
   Deepgram, and ElevenLabs. Until BAA is signed, demo only.
3. **Twilio number** — voice-capable. Set on the org's
   `organizations.twilio_phone_number` column (already used for SMS).
4. **Org on Scale plan** — call agent is Scale-only via
   `allowsCallAgent` capability.

## One-time per-clinic setup

### 1. Create the Vapi assistant

There's a one-shot script that reads `src/voice/prompts/receptionist.md`,
loads the tool schemas from `src/voice/tools/schemas.ts`, posts the
assistant config to Vapi, and writes the returned id back to
`organizations.call_agent_assistant_id` automatically.

```bash
# From the repo root, with .env.local populated:
#   VAPI_API_KEY=...                  (private API key)
#   VAPI_WEBHOOK_SECRET=...           (any 32+ char random string;
#                                      set the same value in Vapi
#                                      dashboard → Server URL → Secret)
#   NEXT_PUBLIC_SUPABASE_URL=...
#   SUPABASE_SERVICE_ROLE_KEY=...
#   NEXT_PUBLIC_APP_URL=https://tarhunna.net
#
# Optional voice override (defaults to a neutral Cartesia voice):
#   VAPI_VOICE_PROVIDER=cartesia
#   VAPI_VOICE_ID=sonic-english-female-warm

npx tsx scripts/seed-vapi-assistant.ts <org-id>
```

On success you'll see:

```
[seed-vapi] Created assistant <uuid>
[seed-vapi] Saved call_agent_assistant_id on the org.
[seed-vapi] Done. Visit /settings/call-agent on the dashboard to finish setup.
```

Re-running on the same org creates a fresh assistant and overwrites
the saved id. Old Vapi assistants stay in your account — clean them
up via the Vapi dashboard if you don't want stale ones around.

### 2. Point the Twilio number at our webhook

In the Twilio console, on the org's number, set:
- **Voice configuration → A call comes in → Webhook**:
  `https://<your-app-url>/api/webhooks/twilio/voice`
  HTTP method: POST.
- **Failover URL**: a Twilio Studio flow that just forwards the
  call to the clinic's mobile, in case our webhook 5xxs. Without
  this, a Vercel outage hangs up real patient calls.

### 3. Owner config

Owner visits `/settings/call-agent` and:
- Checks "BAA on file with Vapi".
- Toggles "Accept inbound calls with the AI agent" on.
- Picks a mode (recommended for V1: `after_hours`).
- Sets a fallback E.164 number (clinic mobile).
- Optionally writes a custom greeting.

## End-to-end smoke test

1. Pre-flight: `/settings/call-agent` shows three green checks.
2. Mode: set to `always` for the test.
3. Dial the clinic's Twilio number from a phone.
4. Expect: disclosure opener + recording-consent line, then the
   Vapi agent.
5. Say: "Do you do botox?" — agent confirms (sourced from
   `services` catalog).
6. Say: "Can I come in Tuesday?" — agent reads back 1-2 slots.
7. Pick a slot, give your name + phone + SMS consent.
8. Confirmation SMS arrives within ~30 seconds with `/manage/<token>`.
9. After hangup, `call_logs` row appears with transcript +
   recording URL.

## Reverting

- Toggle off in `/settings/call-agent`. Twilio falls through to the
  fallback number on subsequent calls within seconds.
- To shut down completely: in the Twilio console, point the
  number back at the original answering service.

## Cost ballpark

- Vapi: ~$0.05–0.10 / minute (LLM + STT + TTS bundled).
- Twilio inbound: ~$0.0085 / minute + per-call fee.
- A 4-minute booking call: ~$0.40 all-in.

## Known limitations (W2 work)

- No appointment **read-back** (caller can't ask "when's my next
  appointment") — opens PHI without auth. Deferred.
- No voice **reschedule/cancel** — uses SMS `/manage/<token>` link
  instead.
- No **outbound** AI calls (reminders, callbacks).
- Single shared neutral voice — no per-clinic voice cloning.
- Multi-org throttle is per-IP; Vapi egresses from a small IP pool
  so high volume across tenants could trip the booking endpoints'
  rate limit. Switch to per-org / per-callSid key in W2.
