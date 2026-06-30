import { Input, Label } from '@tarhunna/ui'

export const Default = () => (
  <div className="p-6 max-w-md space-y-3">
    <Input placeholder="Search contacts…" />
    <Input placeholder="Email address" type="email" defaultValue="will@tarhunna.com" />
    <Input placeholder="Phone" type="tel" />
  </div>
)

export const States = () => (
  <div className="p-6 max-w-md space-y-3">
    <Input placeholder="Disabled field" disabled />
    <Input placeholder="Read-only" readOnly defaultValue="cliniq-mvp" />
  </div>
)

export const WithLabel = () => (
  <div className="p-6 max-w-md space-y-1.5">
    <Label htmlFor="service">Service</Label>
    <Input id="service" placeholder="e.g. Botox consultation" />
  </div>
)
