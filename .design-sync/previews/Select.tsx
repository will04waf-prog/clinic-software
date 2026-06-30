import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Label } from '@tarhunna/ui'

export const Default = () => (
  <div className="p-6 max-w-sm space-y-1.5">
    <Label htmlFor="service">Service</Label>
    <Select>
      <SelectTrigger id="service">
        <SelectValue placeholder="Choose a service" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="botox">Botox consultation</SelectItem>
        <SelectItem value="lip-filler">Lip filler</SelectItem>
        <SelectItem value="microneedling">Microneedling</SelectItem>
        <SelectItem value="laser">Laser hair removal</SelectItem>
      </SelectContent>
    </Select>
  </div>
)

export const Disabled = () => (
  <div className="p-6 max-w-sm space-y-1.5">
    <Label htmlFor="provider">Provider</Label>
    <Select disabled>
      <SelectTrigger id="provider">
        <SelectValue placeholder="No providers yet" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="x">x</SelectItem>
      </SelectContent>
    </Select>
  </div>
)
