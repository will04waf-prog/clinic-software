/**
 * AuroraDrift — 2-3 very soft mint/teal radial blobs drifting behind
 * the dark forest sections (Spline neon-capsule / aurora tiles, dimmed
 * to brand restraint: opacity ≤ 0.12, blur 72px, 22-30s loops).
 *
 * Pure CSS animation (globals.css .aurora-*) — zero JS, transform-only,
 * static under prefers-reduced-motion. Server component by design.
 *
 * Usage: the parent section must be `relative overflow-hidden`, with
 * its content lifted to `relative z-10`; drop <AuroraDrift /> as the
 * first child.
 */
export function AuroraDrift() {
  return (
    <div className="aurora-layer" aria-hidden="true">
      <span className="aurora-blob aurora-blob-a" />
      <span className="aurora-blob aurora-blob-b" />
      <span className="aurora-blob aurora-blob-c" />
    </div>
  )
}
