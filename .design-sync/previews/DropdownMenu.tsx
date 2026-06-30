import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, Button,
} from '@tarhunna/ui'

export const RowActions = () => (
  <div className="p-6">
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Lead actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Send SMS</DropdownMenuItem>
        <DropdownMenuItem>Send email</DropdownMenuItem>
        <DropdownMenuItem>Schedule consultation</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Mark as VIP</DropdownMenuItem>
        <DropdownMenuItem className="text-red-600">Archive contact</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
)
