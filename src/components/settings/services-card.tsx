'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ProcedurePicker } from './procedure-picker'
import { useRouter } from 'next/navigation'

interface ServicesCardProps {
  initial: string[] | null
}

export function ServicesCard({ initial }: ServicesCardProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>(initial ?? [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    const res = await fetch('/api/org/procedures', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ procedures: selected }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 2500)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Services &amp; Procedures</CardTitle>
        <p className="text-sm text-gray-500 mt-1">
          Choose which services appear on your intake form. Custom services can be added below.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <ProcedurePicker selected={selected} onChange={setSelected} />
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Services'}
          </Button>
          {saved && <span className="text-sm text-green-600">Saved!</span>}
        </div>
      </CardContent>
    </Card>
  )
}
