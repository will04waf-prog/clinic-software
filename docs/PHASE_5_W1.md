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

The system prompt + tool schemas live in `src/voice/prompts/receptionist.md`
and `src/voice/tools/schemas.ts`. Pushing them to Vapi:

```typescript
import { readFileSync } from 'fs'
import { ALL_TOOLS } from '@/voice/tools/schemas'

const prompt = readFileSync('src/voice/prompts/receptionist.md', 'utf-8')

const res = await fetch('https://api.vapi.ai/assistant', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: '<clinic name> receptionist',
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: prompt }],
      tools: ALL_TOOLS.map(t => ({
        ...t,
        server: {
          url: `${process.env.NEXT_PUBLIC_APP_URL}/api/voice/tool/${shortName(t.function.name)}`,
          secret: process.env.VAPI_WEBHOOK_SECRET,
        },
      })),
    },
    voice: { provider: 'cartesia', voiceId: '<pick one neutral voice>' },
    firstMessage: '', // intentionally blank — Twilio plays our disclosure opener first
    serverUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/vapi/call-end`,
    serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET,
  }),
})
const { id: assistantId } = await res.json()
```

`shortName` maps:
- `get_context`         → `context`
- `lookup_availability` → `availability`
- `create_hold`         → `hold`
- `confirm_booking`     → `confirm`

Save the returned `assistantId` to
`organizations.call_agent_assistant_id`:

```sql
update organizations
set call_agent_assistant_id = '<assistantId>'
where id = '<org_id>';
```

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
