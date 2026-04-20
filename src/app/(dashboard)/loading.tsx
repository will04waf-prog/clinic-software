export default function DashboardLoading() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="h-6 w-40 rounded bg-gray-100 animate-pulse" />
        <div className="mt-2 h-4 w-64 rounded bg-gray-100 animate-pulse" />
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="h-20 rounded-xl border border-gray-200 bg-white" />
        <div className="h-20 rounded-xl border border-gray-200 bg-white" />
        <div className="h-20 rounded-xl border border-gray-200 bg-white" />
        <div className="h-20 rounded-xl border border-gray-200 bg-white" />
      </div>
    </div>
  )
}
