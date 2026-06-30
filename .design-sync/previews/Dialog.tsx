import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, Button, Input, Label,
} from '@tarhunna/ui'

export const ConfirmAction = () => (
  <div className="p-6">
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button variant="destructive">Cancel appointment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Sarah's appointment?</DialogTitle>
          <DialogDescription>
            This will free up the 2:00 PM slot on Tuesday and send Sarah a cancellation SMS.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline">Keep appointment</Button>
          <Button variant="destructive">Yes, cancel it</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
)

export const QuickForm = () => (
  <div className="p-6">
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button>Add note</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New note</DialogTitle>
          <DialogDescription>Visible to your team only.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-3">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" placeholder="Quick subject line" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline">Cancel</Button>
          <Button>Save note</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
)
