import { Label, Input } from '@tarhunna/ui'

export const InForm = () => (
  <div className="p-6 max-w-md space-y-4">
    <div className="space-y-1.5">
      <Label htmlFor="lead-name">Full name</Label>
      <Input id="lead-name" placeholder="William Gonzalez" />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="lead-phone">Phone</Label>
      <Input id="lead-phone" type="tel" placeholder="+1 (555) 123-4567" />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="lead-email">Email</Label>
      <Input id="lead-email" type="email" placeholder="will@tarhunna.com" />
    </div>
  </div>
)
