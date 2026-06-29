/**
 * GET /api/org/call-agent/vapi-health — pre-flight observability.
 *
 * Queries the LIVE assistant config from Vapi and verifies the two
 * config invariants that, when broken, look identical to "everything
 * works" from outside the system:
 *
 *   1. server.url + every tool's server.url MUST NOT contain
 *      localhost / 127.0.0.1. Vapi cloud cannot reach localhost,
 *      so a localhost URL means mid-call tools silently fail and
 *      the end-of-call webhook vanishes.
 *
 *   2. serverMessages MUST contain 'end-of-call-report'. Vapi
 *      sends tool-call events by default but NOT end-of-call-report
 *      — without explicit subscription, our call_logs table stays
 *      empty forever even though calls connect normally.
 *
 * Both of these have bitten us in W1 and W2. This endpoint is the
 * canary so future drift surfaces in the dashboard, not in lost
 * transcripts.
 *
 * Owner-only + Scale-tier gated to match the rest of the call-agent
 * surface. Slow path (Vapi API takes ~150-400ms) but called only on
 * the settings page mount; we don't cache because the data is small
 * and an owner viewing this page is actively troubleshooting.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'
import { requireCapability } from '@/lib/billing/require-tier'

interface VapiAssistantSnapshot {
  serverUrl?:        string | null
  server?:           { url?: string | null } | null
  serverMessages?:   string[] | null
  model?:            { tools?: Array<{ function?: { name?: string }; server?: { url?: string } }> | null } | null
}

export interface AssistantHealth {
  configured:           boolean   // is an assistant id stamped on the org?
  reachable:            boolean   // did the Vapi GET succeed?
  server_url_ok:        boolean   // is the call-end webhook a non-localhost URL?
  server_messages_ok:   boolean   // does serverMessages include end-of-call-report?
  tools_url_ok:         boolean   // do all tool server.urls avoid localhost?
  // M1: does the Vapi phone-number resource's bound assistant id
  // actually match what we have on organizations.call_agent_assistant_id?
  // A drift here means an inbound call lands at the WRONG assistant —
  // looks healthy from every other angle. Null when the org has no
  // vapi_phone_number_id yet (provisioning not complete).
  phone_assistant_binding_ok: boolean | null
  assistant_id:         string | null
  details?: {
    server_url?:           string | null
    server_messages?:      string[] | null
    bad_tool_count?:       number
    // M1: the assistant id Vapi reports as bound to the phone-number
    // resource, for surfacing in the help text on drift.
    phone_bound_assistant?: string | null
  }
}

async function fetchAssistant(assistantId: string, apiKey: string): Promise<VapiAssistantSnapshot | null> {
  try {
    const res = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(assistantId)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      // Short timeout — this is on the settings page render path; an
      // unresponsive Vapi should not stall the dashboard.
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return await res.json() as VapiAssistantSnapshot
  } catch {
    return null
  }
}

function assessHealth(
  snapshot: VapiAssistantSnapshot | null,
  assistantId: string | null,
  phoneBoundAssistantId: string | null,
): AssistantHealth {
  if (!assistantId) {
    return {
      configured: false,
      reachable: false,
      server_url_ok: false,
      server_messages_ok: false,
      tools_url_ok: false,
      phone_assistant_binding_ok: null,
      assistant_id: null,
    }
  }
  if (!snapshot) {
    return {
      configured: true,
      reachable: false,
      server_url_ok: false,
      server_messages_ok: false,
      tools_url_ok: false,
      // We couldn't reach Vapi — can't assess the binding. null
      // means "indeterminate", distinct from false (which would
      // flag drift in the UI).
      phone_assistant_binding_ok: null,
      assistant_id: assistantId,
    }
  }

  const serverUrl = snapshot.server?.url ?? snapshot.serverUrl ?? null
  const serverUrlOk = !!serverUrl && !/localhost|127\.0\.0\.1/.test(serverUrl)

  const serverMessages = snapshot.serverMessages ?? []
  const serverMessagesOk = serverMessages.includes('end-of-call-report')

  const tools = snapshot.model?.tools ?? []
  const badTools = tools.filter(t => {
    const u = t.server?.url ?? ''
    return /localhost|127\.0\.0\.1/.test(u)
  })

  // M1: if we know which assistant Vapi's phone-number resource is
  // bound to, verify it matches the assistant id we'd actually want
  // to invoke. A mismatch means inbound calls land on stale config —
  // typically a sign that the assistant was re-seeded after the
  // phone-number resource was created (Vapi snapshots the assistant
  // id at phone-number creation time; reseeding the assistant doesn't
  // re-bind).
  const phoneAssistantBindingOk =
    phoneBoundAssistantId == null
      ? null
      : phoneBoundAssistantId === assistantId

  return {
    configured: true,
    reachable: true,
    server_url_ok: serverUrlOk,
    server_messages_ok: serverMessagesOk,
    tools_url_ok: badTools.length === 0,
    phone_assistant_binding_ok: phoneAssistantBindingOk,
    assistant_id: assistantId,
    details: {
      server_url:            serverUrl,
      server_messages:       serverMessages,
      bad_tool_count:        badTools.length,
      phone_bound_assistant: phoneBoundAssistantId,
    },
  }
}

/**
 * GET https://api.vapi.ai/phone-number/{id} — fetch the phone-number
 * resource and return the assistantId it's bound to (or null if the
 * fetch fails). The shape varies subtly by Vapi version; we look in
 * the canonical fields first.
 */
async function fetchPhoneBoundAssistantId(phoneNumberId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.vapi.ai/phone-number/${encodeURIComponent(phoneNumberId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const json = await res.json() as { assistantId?: string | null; assistant?: { id?: string } | null }
    return json.assistantId ?? json.assistant?.id ?? null
  } catch {
    return null
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response

  const cap = await requireCapability(supabase, gate.orgId, 'allowsCallAgent')
  if (!cap.ok) return cap.response

  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    const empty = {
      configured: false, reachable: false, server_url_ok: false,
      server_messages_ok: false, tools_url_ok: false,
      phone_assistant_binding_ok: null, assistant_id: null,
    }
    return NextResponse.json({
      inbound:  empty,
      reminder: empty,
      error: 'vapi_api_key_missing',
    })
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('call_agent_assistant_id, call_agent_reminder_assistant_id, vapi_phone_number_id')
    .eq('id', gate.orgId)
    .single()

  // Three parallel Vapi reads:
  //   1. Inbound assistant config
  //   2. Reminder assistant config
  //   3. M1: the phone-number resource — which assistant is it bound to?
  // Promise.all is fine here because each fetcher already swallows
  // failures and returns null.
  const [inboundSnap, reminderSnap, phoneBoundAssistantId] = await Promise.all([
    org?.call_agent_assistant_id          ? fetchAssistant(org.call_agent_assistant_id, apiKey)          : Promise.resolve(null),
    org?.call_agent_reminder_assistant_id ? fetchAssistant(org.call_agent_reminder_assistant_id, apiKey) : Promise.resolve(null),
    org?.vapi_phone_number_id             ? fetchPhoneBoundAssistantId(org.vapi_phone_number_id, apiKey) : Promise.resolve(null),
  ])

  return NextResponse.json({
    // Only the inbound assistant's binding to the phone-number
    // resource is verifiable — Vapi's phone-number resource binds
    // exactly one assistantId for inbound. The reminder bot is
    // invoked via POST /call per outbound, so its binding is
    // resolved at-call-time and there's nothing to drift against.
    inbound:  assessHealth(inboundSnap,  org?.call_agent_assistant_id          ?? null, phoneBoundAssistantId),
    reminder: assessHealth(reminderSnap, org?.call_agent_reminder_assistant_id ?? null, null),
  })
}
