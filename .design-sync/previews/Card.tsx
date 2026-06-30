import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button } from '@tarhunna/ui'

export const Basic = () => (
  <div className="p-6 max-w-md">
    <Card>
      <CardHeader>
        <CardTitle>Today's bookings</CardTitle>
        <CardDescription>3 consultations scheduled across 2 providers.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between"><span>9:00 AM — Botox consult</span><span className="text-gray-500">Sarah Chen</span></li>
          <li className="flex justify-between"><span>11:30 AM — Lip filler</span><span className="text-gray-500">Marcus Lee</span></li>
          <li className="flex justify-between"><span>2:15 PM — Initial consult</span><span className="text-gray-500">Amara Okafor</span></li>
        </ul>
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm">View calendar</Button>
      </CardFooter>
    </Card>
  </div>
)

export const StatTile = () => (
  <div className="p-6 grid grid-cols-3 gap-4 max-w-3xl">
    <Card>
      <CardHeader>
        <CardDescription>New leads</CardDescription>
        <CardTitle className="text-3xl">24</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-emerald-600">+18% this week</CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardDescription>Calls answered</CardDescription>
        <CardTitle className="text-3xl">147</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-emerald-600">+9 vs last week</CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardDescription>No-show rate</CardDescription>
        <CardTitle className="text-3xl">4.2%</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-emerald-600">-2.1pp</CardContent>
    </Card>
  </div>
)
