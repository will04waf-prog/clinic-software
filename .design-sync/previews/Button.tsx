import { Button } from '@tarhunna/ui'

export const PrimaryVariants = () => (
  <div className="flex flex-wrap gap-3 p-4">
    <Button variant="default">Book a demo</Button>
    <Button variant="secondary">Learn more</Button>
    <Button variant="outline">Skip</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="destructive">Delete contact</Button>
    <Button variant="success">Confirm booking</Button>
    <Button variant="link">Read the docs</Button>
  </div>
)

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3 p-4">
    <Button size="sm">Small</Button>
    <Button size="default">Default</Button>
    <Button size="lg">Large</Button>
  </div>
)

export const Disabled = () => (
  <div className="flex flex-wrap gap-3 p-4">
    <Button disabled>Send SMS</Button>
    <Button variant="outline" disabled>Cancel</Button>
    <Button variant="destructive" disabled>Delete</Button>
  </div>
)
