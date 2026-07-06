/**
 * POST /api/voice/tool/lookup-faq — Phase 5 W2.
 *
 * Fuzzy-matches a caller question ("do you take Care Credit?",
 * "is parking free?", "any locations downtown?") to the owner-
 * authored FAQ corpus stored in organizations.faqs and returns up
 * to 2 candidate answers with confidence scores. Layla reads the
 * highest-scoring answer verbatim when it crosses the threshold;
 * otherwise she falls back to take_message.
 *
 * Why a dedicated tool rather than stuffing FAQs into get_context:
 * the catalog dump in /tool/context is already the longest fixed
 * cost in Layla's opening latency budget and we don't want it to
 * grow proportional to FAQ count. lookup_faq is invoked only when
 * needed and the matcher runs against a per-org corpus capped at
 * 100 entries (organizations_faqs_max_count) so the scan is bounded.
 *
 * Why a dedicated matcher rather than letting the LLM scan the
 * corpus: same reason find_service exists. The LLM is willing to
 * hallucinate plausible answers when it can't find a literal hit;
 * the matcher refuses below MIN_INCLUDE_SCORE and the prompt
 * teaches Layla to fall back to take_message on `no_confident_match`.
 *
 * Scope carve-out: the receptionist prompt tells Layla to PREFER
 * the dedicated tools for hours (get_context), services
 * (find_service / get_context.services), per-service prep
 * (pre_visit_instructions), and address/parking (give_directions).
 * lookup_faq is for the residual long-tail policy/payment/insurance/
 * sister-clinic-location questions only.
 *
 * Read-only. Same gates as find_service:
 *   verifyVapiSignature → org by to_e164 → call_agent_enabled +
 *   call_agent_baa_attested_at attested.
 *
 * No PHI in or out. The corpus is owner-authored generic policy
 * text, and the only side-effect is a fire-and-forget activity_log
 * row on misses so the owner can grow the corpus over time.
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'

// Tunables. Kept inline (not env) so behavior is reproducible across
// deploys and reviewable in a single diff. Numbers chosen to match
// the find_service neighbour:
//   - QUERY_MAX_LEN     same 200 ceiling as find_service.query
//   - MAX_MATCHES       2 — read aloud at most two answers
//   - MIN_INCLUDE_SCORE 0.30 — slightly more permissive than
//     find_service (0.35) because FAQ questions are longer and the
//     token-overlap denominator is bigger; an FAQ matcher trained
//     on real callers tends to lose recall before precision.
const QUERY_MAX_LEN     = 200
const MAX_MATCHES       = 2
const MIN_INCLUDE_SCORE = 0.30

// Shape of a stored FAQ entry. Kept loose at the TS layer because the
// authoritative validation is in the settings server action — the
// route just defends against missing/odd values per row.
interface StoredFaq {
  id?:       unknown
  question?: unknown
  answer?:   unknown
  tags?:     unknown
  position?: unknown
}

/** Lowercase, strip punctuation/symbols, collapse whitespace.
 *  Mirrors find_service.normalizeText so the two tools share their
 *  notion of "same query" — the receptionist's intuition shouldn't
 *  shift between tools. */
function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Tokenize. Drops empty tokens + very short stopwords. Same stop
 *  list as find_service. */
function tokenize(normalized: string): string[] {
  if (!normalized) return []
  const stop = new Set([
    'a', 'an', 'the', 'of', 'for', 'to', 'and', 'with', 'on', 'in',
    'or', 'do', 'does', 'is', 'are', 'you', 'your', 'i', 'me', 'my',
    'we', 'us', 'have', 'has', 'can',
  ])
  return normalized.split(' ').filter(t => t.length > 0 && !stop.has(t))
}

/**
 * Score how well a FAQ entry matches the caller's normalized query.
 * Returns a number in [0, 1].
 *
 * The matchable surface for each FAQ is question + tags (joined by
 * space). The answer is intentionally NOT scored against — answers
 * tend to repeat the question phrasing only loosely and including
 * them would let a long answer about "scheduling" score well against
 * a query about "billing" just because the words overlap.
 */
function scoreFaq(
  normalizedQuery: string,
  queryTokens: string[],
  faq: { question: string; tags: string[] },
): number {
  if (!normalizedQuery) return 0
  const q = normalizeText(faq.question)
  const tagsText = normalizeText((faq.tags ?? []).join(' '))
  const haystack = [q, tagsText].filter(Boolean).join(' ').trim()
  if (!haystack) return 0

  // Exact-question hit wins outright.
  if (q && q === normalizedQuery) return 1

  let score = 0

  // Whole-query substring in the question is the strongest non-exact
  // signal ("do you take care credit" inside "do you take care
  // credit or affirm").
  if (q && q.includes(normalizedQuery)) {
    score = Math.max(score, 0.9)
  }
  // Question contained inside the caller's query — caller said "hey
  // I was wondering do you do gift cards thanks" and the FAQ is
  // "do you do gift cards".
  if (q && normalizedQuery.includes(q)) {
    score = Math.max(score, 0.8)
  }

  // Token overlap against the haystack (question + tags). Each
  // query token scored as: exact = 1.0, prefix = 0.9, suffix = 0.7,
  // substring = 0.6. The best per-token score is summed and divided
  // by the query token count to normalize. We cap the contribution
  // at 0.85 so a pure token-overlap match can never beat an outright
  // substring hit above.
  const hayTokens = tokenize(haystack)
  if (queryTokens.length > 0 && hayTokens.length > 0) {
    let hits = 0
    for (const qt of queryTokens) {
      let bestTokenScore = 0
      for (const ht of hayTokens) {
        if (ht === qt)              { bestTokenScore = 1;   break }
        if (ht.startsWith(qt))      bestTokenScore = Math.max(bestTokenScore, 0.9)
        else if (qt.startsWith(ht)) bestTokenScore = Math.max(bestTokenScore, 0.7)
        else if (ht.includes(qt))   bestTokenScore = Math.max(bestTokenScore, 0.6)
      }
      hits += bestTokenScore
    }
    const overlap = hits / queryTokens.length
    score = Math.max(score, overlap * 0.85)
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
  // Hard cap before we touch anything else — same 200-char ceiling
  // the Vapi schema advertises. Defense in depth against a
  // mis-configured client pasting a transcript.
  const safeQuery = rawQuery.slice(0, QUERY_MAX_LEN)

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

  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, call_agent_enabled, call_agent_baa_attested_at, faqs')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (orgErr) {
    console.error('[voice/tool/lookup-faq] org lookup failed', orgErr.message)
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { matches: [], reason: 'lookup_failed' },
    }))
  }
  if (!org) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'No clinic mapped to this number',
    }))
  }
  if (!org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled for this clinic',
    }))
  }

  // ---- corpus shape-check ----------------------------------------------
  // The column default is '[]'::jsonb and the settings server action
  // enforces array-ness, but supabaseAdmin bypasses RLS so a
  // hand-edited row could be in any shape. Be tolerant: a non-array
  // collapses to the empty-corpus branch rather than 500-ing on
  // every voice call.
  const rawFaqs = Array.isArray(org.faqs) ? (org.faqs as StoredFaq[]) : []
  if (rawFaqs.length === 0) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { matches: [], reason: 'no_faqs_configured' },
    }))
  }

  const normalizedQuery = normalizeText(safeQuery)
  const queryTokens     = tokenize(normalizedQuery)

  // Empty/punctuation-only query → no_confident_match (same family as
  // a low-confidence corpus miss so the prompt branches the same way).
  if (!normalizedQuery) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { matches: [], reason: 'no_confident_match' },
    }))
  }

  // ---- score + rank -----------------------------------------------------
  // Per-row normalization is also defensive — bad entries (missing
  // question, non-string answer) score zero and fall out below the
  // MIN_INCLUDE_SCORE filter. Tags array is coerced to string[] with
  // best-effort filtering so a typo in the settings UI can't break
  // every call.
  const scored = rawFaqs
    .map((entry) => {
      const id       = typeof entry.id       === 'string' ? entry.id       : null
      const question = typeof entry.question === 'string' ? entry.question : ''
      const answer   = typeof entry.answer   === 'string' ? entry.answer   : ''
      const tags     = Array.isArray(entry.tags)
        ? (entry.tags.filter((t) => typeof t === 'string') as string[])
        : []
      const score = scoreFaq(normalizedQuery, queryTokens, { question, tags })
      return { id, question, answer, score }
    })
    .filter((r) => r.id && r.answer && r.score >= MIN_INCLUDE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES)

  if (scored.length === 0) {
    // Fire-and-forget audit row so owners can see what callers asked
    // that wasn't in the corpus and grow it. No PII — only the
    // normalized query string + the org. Mirrors the
    // voice_service_match_miss pattern from find_service.
    after(async () => {
      try {
        await supabaseAdmin.from('activity_log').insert({
          organization_id: org.id,
          action:          'voice_faq_match_miss',
          metadata: {
            query_normalized: normalizedQuery,
            call_sid:         tc.callSid ?? null,
          },
        })
      } catch (err) {
        console.warn('[voice/tool/lookup-faq] activity_log insert failed', err)
      }
    })

    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { matches: [], reason: 'no_confident_match' },
    }))
  }

  // ---- response shape --------------------------------------------------
  // The LLM gets question + answer + a 0..1 score it can branch on.
  // Question is included so Layla can lead in with the canonical
  // phrasing ("our cancellation policy is..."), which reads more
  // naturally than dropping straight into the answer when the caller
  // worded it differently.
  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      matches: scored.map((r) => ({
        id:       r.id,
        question: r.question,
        answer:   r.answer,
        score:    Math.round(r.score * 100) / 100,
      })),
    },
  }))
}
