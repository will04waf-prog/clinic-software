/**
 * Phase 4 W6 — overlap → lanes packing for the calendar grid.
 *
 * Walks items in start-time order; for each event picks the
 * smallest-numbered lane that's free at the event's start. The
 * "total lanes" reported per tile is the max simultaneous overlap
 * WITHIN ITS OVERLAP CLUSTER — NOT the day-wide max. A single
 * 3-way cluster at 9am must not shrink a lone 3pm tile to 1/3 width.
 *
 * Internally compares numeric epoch ms (not ISO strings) so format
 * inconsistencies between stored scheduled_at and trigger-computed
 * end_at (millisecond precision, +00 vs Z, etc.) can't break the
 * half-open interval logic.
 *
 * Pure function. No React, no DB.
 */

export interface LaneItem {
  /** Stable identifier — used for React keys + selection. */
  id: string
  /** ISO 8601 instant the item starts. */
  startUtc: string
  /** ISO 8601 instant the item ends. */
  endUtc:   string
}

export interface LaneAssignment<T extends LaneItem> {
  item: T
  /** Zero-indexed lane within the cluster (left → right). */
  lane: number
  /** Lane count for the OVERLAP CLUSTER this item belongs to. Drives tile width = 1/totalLanes. */
  totalLanes: number
}

/**
 * Pack items into lanes within a single day. Items must already be
 * filtered to one day; this function does not bucket by day.
 *
 * Edge cases:
 *   - Same start time → second item goes to lane 1.
 *   - Adjacent (A.end === B.start) → no overlap, same lane.
 *   - Empty input → empty array.
 *
 * Caller should filter canceled rows before calling — those
 * shouldn't compete for lane space.
 */
export function layoutLanes<T extends LaneItem>(items: T[]): LaneAssignment<T>[] {
  if (items.length === 0) return []

  // Convert ISO → ms once. Numeric compare is format-agnostic
  // (no risk of "2026-06-26T15:00:00+00" vs "2026-06-26T15:00:00.000Z"
  // ordering inconsistencies).
  type WithMs = { item: T; startMs: number; endMs: number }
  const withMs: WithMs[] = items.map(item => ({
    item,
    startMs: new Date(item.startUtc).getTime(),
    endMs:   new Date(item.endUtc).getTime(),
  }))

  // Sort by start time, then by end time DESC so longer items take
  // the smaller-numbered lane when starts tie (visually cleaner).
  withMs.sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs
    return b.endMs - a.endMs
  })

  // ── First pass: assign lanes via earliest-free slot. ──
  const laneEndMs: number[] = []
  const assignments: { item: T; lane: number; startMs: number; endMs: number }[] = []

  for (const w of withMs) {
    let placed = false
    for (let lane = 0; lane < laneEndMs.length; lane++) {
      // <= comparison: half-open intervals, an item starting exactly
      // when the previous ends does NOT overlap and shares the lane.
      if (laneEndMs[lane] <= w.startMs) {
        laneEndMs[lane] = w.endMs
        assignments.push({ item: w.item, lane, startMs: w.startMs, endMs: w.endMs })
        placed = true
        break
      }
    }
    if (!placed) {
      const lane = laneEndMs.length
      laneEndMs.push(w.endMs)
      assignments.push({ item: w.item, lane, startMs: w.startMs, endMs: w.endMs })
    }
  }

  // ── Second pass: identify overlap clusters. ──
  // A cluster is a maximal set of items connected by overlap
  // (transitive: A overlaps B, B overlaps C → A, B, C in one
  // cluster even though A and C don't directly overlap). Walked in
  // start order; current cluster extends while next item starts
  // before the running max-end-so-far.
  const clusterIds: number[] = new Array(assignments.length)
  let currentClusterId = -1
  let currentClusterEnd = -Infinity
  for (let i = 0; i < assignments.length; i++) {
    if (assignments[i].startMs >= currentClusterEnd) {
      currentClusterId++
      currentClusterEnd = assignments[i].endMs
    } else if (assignments[i].endMs > currentClusterEnd) {
      currentClusterEnd = assignments[i].endMs
    }
    clusterIds[i] = currentClusterId
  }

  // ── Third pass: lane count PER cluster. ──
  const lanesPerCluster: number[] = []
  for (let i = 0; i < assignments.length; i++) {
    const cid = clusterIds[i]
    const lane = assignments[i].lane
    lanesPerCluster[cid] = Math.max(lanesPerCluster[cid] ?? 0, lane + 1)
  }

  return assignments.map((a, i) => ({
    item:       a.item,
    lane:       a.lane,
    totalLanes: lanesPerCluster[clusterIds[i]],
  }))
}
