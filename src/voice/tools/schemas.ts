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

export const ALL_TOOLS: VapiTool[] = [
  TOOL_GET_CONTEXT,
  TOOL_LOOKUP_AVAILABILITY,
  TOOL_CREATE_HOLD,
  TOOL_CONFIRM_BOOKING,
]
