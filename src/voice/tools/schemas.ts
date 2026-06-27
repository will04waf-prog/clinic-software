/**
 * Phase 5 W1 — Vapi tool schemas (single source of truth).
 *
 * These are the JSON Schemas we push to a Vapi assistant via the
 * assistant-create API. The shape matches Vapi's tool definition:
 *
 *   {
 *     type: 'function',
 *     async: false,
 *     server: { url, secret },
 *     function: { name, description, parameters: <JSON Schema> }
 *   }
 *
 * The setup script in scripts/seed-vapi-assistant.ts reads from here
 * to build the request body. Keeping the schemas in source means
 * iterating the agent's tools is a code-review-able diff, not a
 * dashboard click.
 */

import type { JSONSchema7 } from 'json-schema'

export interface VapiTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: JSONSchema7
  }
}

const e164Pattern = '^\\+[1-9]\\d{6,14}$'

export const TOOL_GET_CONTEXT: VapiTool = {
  type: 'function',
  function: {
    name: 'get_context',
    description:
      'Load the clinic\'s static context (name, hours, services, fallback phone). Call this on your VERY first turn before saying anything substantive. Returns the service catalog you must use to ground all FAQ replies.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

export const TOOL_LOOKUP_AVAILABILITY: VapiTool = {
  type: 'function',
  function: {
    name: 'lookup_availability',
    description:
      'Find 1-2 open appointment slots for a service. Use the service name the caller said (e.g. "botox"). Returns spoken strings you can read aloud verbatim and a booking_url to text the caller if they prefer self-serve.',
    parameters: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Service name the caller asked about (free-form; resolved against the catalog from get_context).',
        },
      },
      required: ['service'],
    },
  },
}

export const TOOL_CREATE_HOLD: VapiTool = {
  type: 'function',
  function: {
    name: 'create_hold',
    description:
      'Reserve a slot for the caller. Use the service_id, provider_id, and slot_start_utc from a previous lookup_availability call. Captures verbal SMS consent — the caller must have confirmed you can text them before you call this. Returns a hold_token used by confirm_booking.',
    parameters: {
      type: 'object',
      properties: {
        service_id:     { type: 'string', description: 'Service id from get_context.services.' },
        provider_id:    { type: 'string', description: 'Provider id from lookup_availability.slots[*].provider_id.' },
        slot_start_utc: { type: 'string', description: 'ISO 8601 UTC start time from lookup_availability.slots[*].start_utc.' },
        name:           { type: 'string', description: 'Caller\'s first + last name as they said it.' },
        phone:          {
          type:    'string',
          pattern: e164Pattern,
          description: 'Caller\'s phone in E.164 (e.g. +15551234567). Default to the call\'s callerId if the caller confirms it.',
        },
        email:          { type: 'string', description: 'Optional. Empty string if the caller doesn\'t want to give one.' },
        notes:          { type: 'string', description: 'Optional. Anything the caller mentioned (procedure interest, concern, etc).' },
      },
      required: ['service_id', 'provider_id', 'slot_start_utc', 'name', 'phone'],
    },
  },
}

export const TOOL_LOOKUP_MY_APPOINTMENTS: VapiTool = {
  type: 'function',
  function: {
    name: 'lookup_my_appointments',
    description:
      "Look up the caller's own upcoming appointments using their caller ID (from the Vapi envelope). Takes no arguments. Returns { found, appointments[] } with spoken time strings to read back, or { found: false, reason }. If found:false, do NOT ask the caller to dictate a different phone number — offer take_message instead.",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

export const TOOL_RESCHEDULE_APPOINTMENT: VapiTool = {
  type: 'function',
  function: {
    name: 'reschedule_appointment',
    description:
      "Reschedule one of the caller's existing appointments to a new slot. Use AFTER lookup_my_appointments returned the consultation AND lookup_availability gave you a target slot AND the caller confirmed the swap. The route re-verifies caller ownership and refuses if the new slot is already taken (rescheduled:false, reason:'slot_taken' — offer another slot).",
    parameters: {
      type: 'object',
      properties: {
        consultation_id: {
          type: 'string',
          description: 'consultation_id from a prior lookup_my_appointments result.',
        },
        new_slot_start_utc: {
          type: 'string',
          description: 'ISO 8601 UTC start time of the new slot, from lookup_availability.slots[*].start_utc.',
        },
        new_provider_id: {
          type: 'string',
          description: 'Optional provider id from lookup_availability.slots[*].provider_id. If omitted, the existing provider is kept.',
        },
      },
      required: ['consultation_id', 'new_slot_start_utc'],
    },
  },
}

export const TOOL_CANCEL_APPOINTMENT: VapiTool = {
  type: 'function',
  function: {
    name: 'cancel_appointment',
    description:
      "Cancel one of the caller's upcoming appointments. Use ONLY after lookup_my_appointments returned a match AND the caller explicitly confirmed which one to cancel (read the date/time back to them first). The consultation_id MUST come from a prior lookup_my_appointments result — never guess. The route re-verifies the consultation belongs to the caller (caller-ID-gated), so a wrong id is safe-fail.",
    parameters: {
      type: 'object',
      properties: {
        consultation_id: {
          type: 'string',
          description: 'consultation_id from a prior lookup_my_appointments.appointments[*] entry.',
        },
      },
      required: ['consultation_id'],
    },
  },
}

export const TOOL_CONFIRM_BOOKING: VapiTool = {
  type: 'function',
  function: {
    name: 'confirm_booking',
    description:
      'Finalize a held booking. Use the consultation_id and hold_token from the previous create_hold call. Triggers the confirmation SMS with /manage link. Read back the time after this returns ok.',
    parameters: {
      type: 'object',
      properties: {
        consultation_id: { type: 'string' },
        hold_token:      { type: 'string' },
      },
      required: ['consultation_id', 'hold_token'],
    },
  },
}

export const TOOL_FIND_SERVICE: VapiTool = {
  type: 'function',
  function: {
    name: 'find_service',
    description:
      "Fuzzy-match what the caller said they want ('lip filler', 'tox', 'baby botox', 'laser for spots') to one or more services in this clinic's catalog. Use BEFORE calling lookup_availability or create_hold so you pick the right service_id instead of guessing from the catalog dump. Returns up to N ranked candidates with a confidence score and short description. If best_match_id is set, you may proceed straight to lookup_availability with that id; otherwise read the candidate names back and ask which one they mean. If matches is empty (reason: 'no_confident_match' or 'empty_query'), apologize and ask the caller to describe what they want a different way.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "The raw phrase the caller said. Server normalizes it. Max 200 chars.",
        },
        max_results: {
          type: 'integer',
          description: 'Cap on candidates returned. Defaults to 3, max 5.',
          minimum: 1,
          maximum: 5,
        },
      },
      required: ['query'],
    },
  },
}

export const TOOL_GIVE_DIRECTIONS: VapiTool = {
  type: 'function',
  function: {
    name: 'give_directions',
    description:
      "Returns the clinic's spoken street address and Google/Apple Maps deep links so Layla can read directions aloud. Pair with send_link_sms (link_kind='directions') when the caller wants a tap-to-open map. Returns ok:false with error='no_address_configured' if the org has not set an address — in that case fall back to handing off to the front desk.",
    parameters: {
      type: 'object',
      properties: {
        include_parking_notes: {
          type: 'boolean',
          description:
            "Defaults true. When true and the org has directions_notes set (e.g. 'free parking in the rear lot'), the spoken response appends them.",
        },
      },
      required: [],
    },
  },
}

export const TOOL_SEND_LINK_SMS: VapiTool = {
  type: 'function',
  function: {
    name: 'send_link_sms',
    description:
      "Mid-call: text the caller a one-tap link. Use when the caller agrees to be texted a booking page, a self-serve manage/reschedule link for an existing appointment, the new-patient intake form, or directions to the clinic. ALWAYS verbally confirm first ('want me to text it to you?') and only set consent_confirmed=true once they say yes. The destination is the caller's own number — you cannot text anyone else. Returns { sent: true } on success, or { sent: false, reason } when blocked.",
    parameters: {
      type: 'object',
      properties: {
        link_kind: {
          type: 'string',
          enum: ['booking', 'manage', 'intake', 'directions'],
          description:
            "Which canonical link to send. 'booking' → public booking page (optionally narrowed by service_slug). 'manage' → self-reschedule/cancel link for an existing consultation (requires consultation_id from a prior lookup_my_appointments call). 'intake' → the clinic's new-patient form. 'directions' → Google Maps deep link to the clinic.",
        },
        consent_confirmed: {
          type: 'boolean',
          description:
            'Must be true. Set ONLY after the caller verbally agrees to receive the text.',
        },
        consultation_id: {
          type: 'string',
          description:
            "UUID of the consultation to manage. Required when link_kind='manage'. Use the value from a prior lookup_my_appointments result.",
        },
        service_slug: {
          type: 'string',
          description:
            "Optional. When link_kind='booking', narrows the link to a specific service. Silently dropped if it doesn't match.",
        },
      },
      required: ['link_kind', 'consent_confirmed'],
    },
  },
}

export const TOOL_TAKE_MESSAGE: VapiTool = {
  type: 'function',
  function: {
    name: 'take_message',
    description:
      'Take a message from the caller for the clinic owner to follow up on async. Use this when the caller has a request you cannot fully resolve in the call OR when the caller explicitly asks to leave a message. Before invoking, you MUST: (1) collect the caller_name, (2) collect the message_text and READ IT BACK verbatim for confirmation, (3) ask their callback preference, (4) judge urgency. The caller phone is captured automatically from the call envelope — do not ask for it.',
    parameters: {
      type: 'object',
      properties: {
        caller_name: {
          type: 'string',
          description: "The caller's name as they said it. Max 120 chars.",
          maxLength: 120,
        },
        message_text: {
          type: 'string',
          description: "The message body in the caller's own words. Read back verbatim before invoking. Max 2000 chars.",
          maxLength: 2000,
        },
        callback_preference: {
          type: 'string',
          enum: ['call', 'text', 'either'],
          description: "How the caller prefers to be reached back. Default 'either' if not stated.",
        },
        urgency: {
          type: 'string',
          enum: ['normal', 'urgent'],
          description: "Use 'urgent' only when the caller explicitly says so or for time-sensitive clinical concerns.",
        },
      },
      required: ['caller_name', 'message_text'],
    },
  },
}

export const TOOL_TRANSFER_TO_HUMAN: VapiTool = {
  type: 'function',
  function: {
    name: 'transfer_to_human',
    description:
      "Hand the call to a human at the clinic. Call this ONLY when you cannot help: clinical/medical questions, complaints, billing disputes, explicit ask for a human, or anything outside booking/availability/cancellation/messages. Do NOT use it just because the caller sounds frustrated — try once to resolve first. The destination phone is read server-side from the clinic's configured fallback. If the server returns transferred:false with reason:'fallback_unavailable', immediately call take_message instead.",
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['clinical_question','complaint','billing_dispute','staff_request','caller_requested_human','other'],
          description: 'Why you are handing off. Surfaced to the receiving human and logged for owner triage.',
        },
        caller_name: {
          type: 'string',
          description: "Caller's name if collected. Optional. Max 80 chars.",
        },
        summary: {
          type: 'string',
          description: 'One-sentence, non-clinical summary of what the caller wants. Do NOT include medical details. Max 280 chars.',
        },
      },
      required: ['reason'],
    },
  },
}

export const TOOL_PRE_VISIT_INSTRUCTIONS: VapiTool = {
  type: 'function',
  function: {
    name: 'pre_visit_instructions',
    description:
      "Return the owner-authored pre-visit prep text for a service. Call this AFTER a booking is confirmed, or when the caller asks 'is there anything I need to do beforehand?'. Read the returned `instructions` aloud verbatim. If `has_instructions` is false, tell the caller there's no special prep needed.",
    parameters: {
      type: 'object',
      properties: {
        service_id: {
          type: 'string',
          description: 'UUID of the service (from find_service or get_context).',
        },
      },
      required: ['service_id'],
    },
  },
}

export const TOOL_POST_CALL_SUMMARY_EMAIL: VapiTool = {
  type: 'function',
  function: {
    name: 'post_call_summary_email',
    description:
      "Call at the END of every call to log a structured disposition + PHI-free summary and email the owner. Use the closed-enum disposition. summary_text is generic prose for the in-app log — DO NOT include phone numbers, specific dates, or PHI; the server will strip them.",
    parameters: {
      type: 'object',
      properties: {
        disposition: {
          type: 'string',
          enum: ['booked','rescheduled','canceled','info_only','message_taken','transferred','abandoned','escalation_needed'],
          description: 'How the call resolved.',
        },
        summary_text: {
          type: 'string',
          maxLength: 280,
          description: 'One-line generic prose summary. ≤280 chars. NEVER emailed; persisted in-app only.',
        },
        contact_resolved: {
          type: 'boolean',
          description: 'true if the caller matched an existing contact record.',
        },
      },
      required: ['disposition','summary_text','contact_resolved'],
    },
  },
}

export const ALL_TOOLS: VapiTool[] = [
  TOOL_GET_CONTEXT,
  TOOL_FIND_SERVICE,
  TOOL_LOOKUP_AVAILABILITY,
  TOOL_LOOKUP_MY_APPOINTMENTS,
  TOOL_RESCHEDULE_APPOINTMENT,
  TOOL_CANCEL_APPOINTMENT,
  TOOL_CREATE_HOLD,
  TOOL_CONFIRM_BOOKING,
  TOOL_GIVE_DIRECTIONS,
  TOOL_SEND_LINK_SMS,
  TOOL_TAKE_MESSAGE,
  TOOL_TRANSFER_TO_HUMAN,
  TOOL_PRE_VISIT_INSTRUCTIONS,
  TOOL_POST_CALL_SUMMARY_EMAIL,
]
