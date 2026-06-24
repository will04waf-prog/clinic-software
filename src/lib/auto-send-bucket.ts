/**
 * Auto-send bucket hashing — Phase 2 W12.
 *
 * Deterministic FNV-1a 32-bit hash used to bucket a (contactId,
 * messageClass) pair into a stable 0..99 slot. This is the rollout
 * dial's serialization key: a contact's bucket is sticky, so flipping
 * the rollout_pct knob never moves the same patient between
 * AI-replied and human-reviewed on identical inbound types.
 *
 * IMPORTANT: do NOT change the hash function or the input format
 * without a migration plan — every existing contact would re-bucket,
 * which is a visible UX change ("Patient X used to get auto-replies,
 * now suddenly doesn't"). Treat this like a sticky-cohort algorithm.
 *
 * Pure, dependency-free, unit-testable in isolation.
 */

/**
 * FNV-1a 32-bit hash. Standard offset basis and prime per the
 * Fowler-Noll-Vo reference. Returned as an unsigned 32-bit integer.
 */
export function fnv1aHash32(input: string): number {
  let hash = 0x811c9dc5 // FNV offset basis (32-bit)
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i) & 0xff
    // Multiply by FNV prime (16777619), keep as uint32.
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * Map a (contactId, messageClass) pair to a stable bucket in 0..99.
 *
 * Compared against the org's rollout_pct: if bucket < rollout_pct the
 * contact-class pair is IN the rollout cohort, otherwise OUT.
 *
 * Format is `${contactId}:${messageClass}`. Locked — see file-level
 * note about not changing without a migration plan.
 */
export function bucketForContactClass(contactId: string, messageClass: string): number {
  return fnv1aHash32(`${contactId}:${messageClass}`) % 100
}
