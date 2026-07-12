/**
 * POST /api/voice/tool/find-service — Phase 5 W2.
 *
 * Fuzzy-matches a caller phrase ("lip filler", "tox", "baby botox",
 * "laser for spots") to one or more services in the org catalog and
 * returns spoken-friendly candidates the LLM can use for
 * disambiguation, plus the canonical service_ids it can feed back
 * into lookup_availability / create_hold.
 *
 * Why a dedicated matcher rather than letting the LLM pick from the
 * /tool/context dump: today the LLM hallucinates service names and
 * matches brand-name aliases incorrectly ("lip filler" → "filler
 * consult"). The catalog stays the source of truth here; the LLM
 * gets a short, ranked list and can ask "did you mean Lip Filler or
 * Lip Flip?" instead of guessing.
 *
 * Read-only. Same gates as the other booking-side voice tools:
 *   verifyVapiSignature → org by to_e164 → call_agent_enabled +
 *   call_agent_baa_attested_at attested → catalog limited to
 *   is_active + is_bookable_online (defense-in-depth so the LLM can
 *   never funnel a discontinued service into a booking flow).
 *
 * No PII is read or written. The only side-effect is an
 * activity_log row when nothing crossed the confidence threshold,
 * so the team can grow aliases over time. Fired via after() so the
 * tool response stays under the Vapi 5s budget.
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'

// Tunables. Kept here (not env) so behavior is reproducible across
// deploys and easy to read in PR review.
const QUERY_MAX_LEN     = 200
const DEFAULT_MAX_RESULTS = 3
const HARD_MAX_RESULTS    = 5
// Minimum score (0..1) for a candidate to appear in `matches` at
// all. Anything below this is noise.
const MIN_INCLUDE_SCORE = 0.35
// Score gap above which we surface a single `best_match_id` to the
// LLM — i.e. "this is clearly the one, no need to disambiguate".
const STRONG_MATCH_SCORE = 0.7

/** Lowercase, strip punctuation/symbols, collapse whitespace. */
function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    // Replace any non-alphanumeric run with a single space.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Tokenize after normalizeText. Drops empty tokens + very short
 *  stopwords that add no matching value ("a", "i", "of", "the"). */
function tokenize(normalized: string): string[] {
  if (!normalized) return []
  const stop = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'and', 'with', 'on', 'in', 'or'])
  return normalized.split(' ').filter(t => t.length > 0 && !stop.has(t))
}

/**
 * Score how well a service matches the caller's normalized query.
 * Returns a number in [0, 1]. Designed to be lenient on token order
 * (callers say "filler lip" as often as "lip filler") and to give
 * partial credit for prefix matches ("tox" → "botox", "baby botox").
 */
function scoreService(
  normalizedQuery: string,
  queryTokens: string[],
  service: { name: string | null; description: string | null },
): number {
  if (!normalizedQuery) return 0
  const name = normalizeText(service.name ?? '')
  const desc = normalizeText(service.description ?? '')
  if (!name && !desc) return 0

  // Exact name hit wins outright.
  if (name === normalizedQuery) return 1

  let score = 0

  // Whole-query substring in the service name is a very strong
  // signal ("lip filler" inside "Lip Filler Touch-Up").
  if (name && name.includes(normalizedQuery)) {
    score = Math.max(score, 0.9)
  }
  // The service name being inside the query is weaker but still
  // useful — caller said "I want some baby botox please" and the
  // service is "Baby Botox".
  if (name && normalizedQuery.includes(name)) {
    score = Math.max(score, 0.8)
  }

  // Token-level overlap against the name. Each query token that
  // appears as a substring of any name token earns credit; prefix
  // matches earn full credit, mid-word substrings earn half. This
  // is what makes "tox" → "botox" work.
  const nameTokens = tokenize(name)
  if (queryTokens.length > 0 && nameTokens.length > 0) {
    let hits = 0
    for (const q of queryTokens) {
      let bestTokenScore = 0
      for (const n of nameTokens) {
        if (n === q)              { bestTokenScore = 1;   break }
        if (n.startsWith(q))      bestTokenScore = Math.max(bestTokenScore, 0.9)
        else if (q.startsWith(n)) bestTokenScore = Math.max(bestTokenScore, 0.7)
        else if (n.includes(q))   bestTokenScore = Math.max(bestTokenScore, 0.6)
      }
      hits += bestTokenScore
    }
    const overlap = hits / queryTokens.length
    // Token overlap maxes out around 0.85 so it can't beat a true
    // substring/exact match above.
    score = Math.max(score, overlap * 0.85)
  }

  // Description matches are a much weaker tie-breaker — somebody
  // saying "for spots" might land on a service whose description
  // mentions "spots".
  if (desc && queryTokens.length > 0) {
    let descHits = 0
    for (const q of queryTokens) {
      if (q.length >= 3 && desc.includes(q)) descHits += 1
    }
    if (descHits > 0) {
      const descScore = Math.min(0.5, (descHits / queryTokens.length) * 0.5)
      score = Math.max(score, descScore)
    }
  }

  return Math.min(1, score)
}

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  // ---- input validation -------------------------------------------------
  const rawQuery = tc.arguments.query
  if (typeof rawQuery !== 'string') {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or invalid query (string required)',
    }))
  }
  // Hard cap before we touch anything else — defense against a
  // 50k-token "query" pasted into the dashboard.
  const safeQuery = rawQuery.slice(0, QUERY_MAX_LEN)

  // max_results: integer 1..5, default 3. Tolerate strings (LLM
  // sometimes JSON-encodes numbers as strings).
  let maxResults = DEFAULT_MAX_RESULTS
  const rawMax = tc.arguments.max_results
  if (typeof rawMax === 'number' && Number.isFinite(rawMax)) {
    maxResults = Math.floor(rawMax)
  } else if (typeof rawMax === 'string' && rawMax.trim() !== '') {
    const parsed = Number.parseInt(rawMax, 10)
    if (Number.isFinite(parsed)) maxResults = parsed
  }
  if (maxResults < 1) maxResults = 1
  if (maxResults > HARD_MAX_RESULTS) maxResults = HARD_MAX_RESULTS

  // ---- to_e164 + org resolution ----------------------------------------
  // Identity hard-locked to call envelope in prod; LLM-supplied
  // to_e164/from_e164/phone_number args refused outside dev.
  const { toE164 } = await resolveCallEnvelope(tc)
  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, call_agent_enabled, call_agent_baa_attested_at')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (!org) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'No business mapped to this number',
    }))
  }
  if (!org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled for this business',
    }))
  }

  // ---- catalog fetch ----------------------------------------------------
  // Same filter set the /context route uses — keep them in sync so the
  // LLM never sees a service through find_service that it couldn't
  // book through hold/availability.
  const { data: services, error: servicesErr } = await supabaseAdmin
    .from('services')
    .select('id, name, description, duration_min')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .eq('is_bookable_online', true)
  if (servicesErr) {
    // Surface a distinct soft-fail reason — DB blip should not look
    // like "we don't offer that service" to the caller.
    console.error('[voice/find-service] services lookup failed', servicesErr.message)
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { matches: [], reason: 'lookup_failed' },
    }))
  }

  const normalizedQuery = normalizeText(safeQuery)
  const queryTokens     = tokenize(normalizedQuery)

  // Empty/punctuation-only query → can't score. Return the no-match
  // shape rather than a hard error so the LLM stays in dialogue.
  if (!normalizedQuery) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { matches: [], reason: 'empty_query' },
    }))
  }

  // ---- score + rank -----------------------------------------------------
  const scored = (services ?? [])
    .map(s => ({
      service: s,
      score: scoreService(normalizedQuery, queryTokens, s),
    }))
    .filter(r => r.score >= MIN_INCLUDE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)

  // ---- no-confident-match path -----------------------------------------
  if (scored.length === 0) {
    // Fire-and-forget audit row so the team can grow aliases. No
    // PII — only the normalized query and the org. Wrapped in
    // after() + try/catch so a write failure never bubbles back to
    // the caller.
    after(async () => {
      try {
        await supabaseAdmin.from('activity_log').insert({
          organization_id: org.id,
          action:          'voice_service_match_miss',
          metadata: {
            query_normalized: normalizedQuery,
            call_sid:         tc.callSid ?? null,
          },
        })
      } catch (err) {
        console.warn('[voice/tool/find-service] activity_log insert failed', err)
      }
    })

    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { matches: [], reason: 'no_confident_match' },
    }))
  }

  // ---- response shape --------------------------------------------------
  const matches = scored.map(r => ({
    service_id:        r.service.id,
    name:              r.service.name,
    confidence:        Math.round(r.score * 100) / 100,
    short_description: r.service.description
      // Cap to something speakable; the LLM may read this aloud.
      ? r.service.description.slice(0, 160)
      : null,
  }))

  // Surface a `best_match_id` only when the top result is clearly
  // ahead — either above STRONG_MATCH_SCORE outright, or noticeably
  // ahead of the runner-up (>0.2 gap). Otherwise the LLM should
  // disambiguate verbally.
  const top    = scored[0]
  const second = scored[1]
  const isStrong =
    top.score >= STRONG_MATCH_SCORE ||
    (second ? (top.score - second.score) >= 0.2 : true)
  const best_match_id = isStrong ? top.service.id : null

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      matches,
      best_match_id,
    },
  }))
}
