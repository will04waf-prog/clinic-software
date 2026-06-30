import { Tabs, TabsList, TabsTrigger, TabsContent, Card, CardContent } from '@tarhunna/ui'

export const Default = () => (
  <div className="p-6 max-w-2xl">
    <Tabs defaultValue="upcoming">
      <TabsList>
        <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
        <TabsTrigger value="past">Past</TabsTrigger>
        <TabsTrigger value="canceled">Canceled</TabsTrigger>
      </TabsList>
      <TabsContent value="upcoming" className="mt-4">
        <Card><CardContent className="p-4 text-sm">3 consultations this week.</CardContent></Card>
      </TabsContent>
      <TabsContent value="past" className="mt-4">
        <Card><CardContent className="p-4 text-sm">28 completed consultations in the last 30 days.</CardContent></Card>
      </TabsContent>
      <TabsContent value="canceled" className="mt-4">
        <Card><CardContent className="p-4 text-sm">2 canceled, 1 no-show this month.</CardContent></Card>
      </TabsContent>
    </Tabs>
  </div>
)
