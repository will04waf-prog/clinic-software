/**
 * Route-level transition for every dashboard page. App Router
 * remounts a template on navigation, so the single .rise here gives
 * each page change a 450ms fade-lift — the app feels continuous
 * instead of snapping between static screens. (Server component:
 * pure CSS animation, zero JS cost; reduced-motion disables it in
 * globals.css.)
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="rise h-full">{children}</div>
}
