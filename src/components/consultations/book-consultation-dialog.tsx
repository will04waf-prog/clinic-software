'use client'
import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PROCEDURES, type Procedure } from '@/types'
import { formatProcedure } from '@/lib/utils'

const schema = z.object({
  scheduled_at:      z.string().min(1, 'Date and time are required'),
  duration_min:      z.number().int().min(15).max(480),
  type:              z.enum(['in_person', 'virtual'] as const),
  pre_consult_notes: z.string().max(2000).optional(),
})

type FormValues = z.infer<typeof schema>

interface BookConsultationDialogProps {
  contactId: string
  onSuccess?: () => void
}

export function BookConsultationDialog({ contactId, onSuccess }: BookConsultationDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedProcedures, setSelectedProcedures] = useState<Procedure[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { duration_min: 60, type: 'in_person' },
  })

  function toggleProcedure(p: Procedure) {
    setSelectedProcedures((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )
  }

  async function onSubmit(values: FormValues) {
    setLoading(true)
    setError(null)
    try {
      // Convert local datetime-local value to ISO string
      const scheduledAt = new Date(values.scheduled_at).toISOString()

      const res = await fetch('/api/consultations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          scheduled_at: scheduledAt,
          duration_min: values.duration_min,
          type: values.type,
          pre_consult_notes: values.pre_consult_notes || undefined,
          procedure_discussed: selectedProcedures,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to book consultation')
      }

      reset()
      setSelectedProcedures([])
      setOpen(false)
      onSuccess?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlus className="h-4 w-4" />
          Book Consultation
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Book Consultation</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Date + time */}
          <div className="space-y-1.5">
            <Label htmlFor="scheduled_at">Date & Time *</Label>
            <Input
              id="scheduled_at"
              type="datetime-local"
              {...register('scheduled_at')}
            />
            {errors.scheduled_at && (
              <p className="text-xs text-red-500">{errors.scheduled_at.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Duration */}
            <div className="space-y-1.5">
              <Label htmlFor="duration_min">Duration (min)</Label>
              <Select
                defaultValue="60"
                onValueChange={(v) => setValue('duration_min', parseInt(v))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="45">45 min</SelectItem>
                  <SelectItem value="60">60 min</SelectItem>
                  <SelectItem value="90">90 min</SelectItem>
                  <SelectItem value="120">120 min</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Type */}
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                defaultValue="in_person"
                onValueChange={(v) => setValue('type', v as 'in_person' | 'virtual')}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_person">In-Person</SelectItem>
                  <SelectItem value="virtual">Virtual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Procedures */}
          <div className="space-y-1.5">
            <Label>Procedures to Discuss</Label>
            <div className="flex flex-wrap gap-2">
              {PROCEDURES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggleProcedure(p)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    selectedProcedures.includes(p)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {formatProcedure(p)}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="pre_consult_notes">Pre-Consult Notes</Label>
            <Textarea
              id="pre_consult_notes"
              {...register('pre_consult_notes')}
              placeholder="Anything the team should know before this consultation..."
              rows={3}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Booking...' : 'Book Consultation'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
