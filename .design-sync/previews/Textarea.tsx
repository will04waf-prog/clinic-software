import { Textarea, Label } from '@tarhunna/ui'

export const Default = () => (
  <div className="p-6 max-w-md space-y-1.5">
    <Label htmlFor="notes">Internal notes</Label>
    <Textarea id="notes" rows={4} placeholder="Anything the team should know about this lead…" />
  </div>
)

export const WithContent = () => (
  <div className="p-6 max-w-md space-y-1.5">
    <Label htmlFor="msg">Reply</Label>
    <Textarea
      id="msg"
      rows={5}
      defaultValue="Hi Sarah, your appointment is confirmed for Tuesday at 2pm. Reply STOP to opt out."
    />
  </div>
)
