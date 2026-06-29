<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Multi-clinic phone infrastructure

Each organization owns a dedicated Twilio number registered against its own A2P 10DLC brand and bound to a Vapi assistant; provisioning is driven by the `provisioning_jobs` queue + `/api/cron/provisioning` runner, A2P approval is polled by `/api/cron/a2p-status`, and per-clinic voice + SMS usage is flushed nightly to Stripe via `/api/cron/report-usage` — see [docs/MULTI_CLINIC_RUNBOOK.md](docs/MULTI_CLINIC_RUNBOOK.md) for the operator walkthrough.
