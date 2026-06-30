import { Badge } from '@tarhunna/ui'

export const Variants = () => (
  <div className="flex flex-wrap gap-2 p-4">
    <Badge variant="default">Scheduled</Badge>
    <Badge variant="secondary">New lead</Badge>
    <Badge variant="outline">Pro plan</Badge>
    <Badge variant="destructive">Failed</Badge>
  </div>
)

export const InContext = () => (
  <div className="flex flex-col gap-3 p-4 text-sm">
    <div className="flex items-center gap-2"><span>William Gonzalez</span><Badge variant="secondary">VIP</Badge></div>
    <div className="flex items-center gap-2"><span>Sarah Chen</span><Badge>Confirmed</Badge></div>
    <div className="flex items-center gap-2"><span>Marcus Lee</span><Badge variant="outline">Returning</Badge></div>
  </div>
)
