'use client'
import { useState } from 'react'
import { Plus, Trash2, Mail, MessageSquare, Clock, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { AutomationSequence, SequenceStep } from '@/types'

const TRIGGER_LABELS: Record<string, string> = {
  new_lead: 'New Lead Created',
  stage_changed: 'Stage Changed',
  no_show: 'Consultation No-Show',
  old_lead_reactivation: 'Old Lead (30+ days inactive)',
  consultation_booked: 'Consultation Booked',
  consultation_completed: 'Consultation Completed',
}

const TEMPLATE_VARS = '{{first_name}}, {{clinic_name}}, {{clinic_phone}}'

interface StepEditorProps {
  step: Partial<SequenceStep> & { _id: string }
  index: number
  onUpdate: (id: string, updates: Partial<SequenceStep>) => void
  onRemove: (id: string) => void
}

function StepEditor({ step, index, onUpdate, onRemove }: StepEditorProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-gray-300" />
          <span className="text-xs font-semibold text-gray-500 uppercase">Step {index + 1}</span>
          {step.channel === 'email'
            ? <Badge variant="default"><Mail className="h-3 w-3 mr-1" />Email</Badge>
            : <Badge variant="secondary"><MessageSquare className="h-3 w-3 mr-1" />SMS</Badge>
          }
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-500" onClick={() => onRemove(step._id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Channel</Label>
          <Select value={step.channel ?? 'email'} onValueChange={(v) => onUpdate(step._id, { channel: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Send after (hours)
          </Label>
          <Input
            type="number"
            min={0}
            value={step.delay_hours ?? 0}
            onChange={(e) => onUpdate(step._id, { delay_hours: parseInt(e.target.value) || 0 })}
            placeholder="0"
          />
        </div>
      </div>

      {step.channel === 'email' && (
        <div className="space-y-1.5">
          <Label>Subject</Label>
          <Input
            value={step.subject ?? ''}
            onChange={(e) => onUpdate(step._id, { subject: e.target.value })}
            placeholder="Quick question about your consultation..."
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>
          Message Body
          <span className="ml-2 text-xs text-gray-400 font-normal">Use: {TEMPLATE_VARS}</span>
        </Label>
        <Textarea
          value={step.body ?? ''}
          onChange={(e) => onUpdate(step._id, { body: e.target.value })}
          placeholder={`Hi {{first_name}}, this is {{clinic_name}}...`}
          rows={4}
        />
      </div>
    </div>
  )
}

interface SequenceEditorProps {
  sequence?: AutomationSequence
  onSave: (data: any) => Promise<void>
  onCancel: () => void
}

type DraftStep = Partial<SequenceStep> & { _id: string }

export function SequenceEditor({ sequence, onSave, onCancel }: SequenceEditorProps) {
  const [name, setName] = useState(sequence?.name ?? '')
  const [triggerType, setTriggerType] = useState(sequence?.trigger_type ?? 'new_lead')
  const [isActive, setIsActive] = useState(sequence?.is_active ?? true)
  const [steps, setSteps] = useState<DraftStep[]>(
    (sequence?.steps ?? []).map((s) => ({ ...s, _id: s.id }))
  )
  const [saving, setSaving] = useState(false)

  function addStep() {
    setSteps((prev) => [
      ...prev,
      { _id: crypto.randomUUID(), channel: 'email', delay_hours: prev.length === 0 ? 0 : 24, body: '', subject: '', position: prev.length },
    ])
  }

  function updateStep(id: string, updates: Partial<SequenceStep>) {
    setSteps((prev) => prev.map((s) => s._id === id ? { ...s, ...updates } : s))
  }

  function removeStep(id: string) {
    setSteps((prev) => prev.filter((s) => s._id !== id))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({
        name,
        trigger_type: triggerType,
        is_active: isActive,
        steps: steps.map((s, i) => ({
          channel: s.channel,
          delay_hours: s.delay_hours ?? 0,
          subject: s.subject,
          body: s.body,
          position: i,
        })),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Sequence settings */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Sequence Settings</h3>

        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New Lead Follow-Up" />
        </div>

        <div className="space-y-1.5">
          <Label>Trigger</Label>
          <Select value={triggerType} onValueChange={(v) => setTriggerType(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => setIsActive(!isActive)}
              className={`relative h-5 w-9 rounded-full transition-colors ${isActive ? 'bg-indigo-600' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-gray-700">{isActive ? 'Active' : 'Inactive'}</span>
          </label>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Steps ({steps.length})</h3>
          <Button variant="outline" size="sm" onClick={addStep}>
            <Plus className="h-4 w-4" />
            Add Step
          </Button>
        </div>

        {steps.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-400">No steps yet. Add your first message.</p>
          </div>
        )}

        {steps.map((step, index) => (
          <StepEditor
            key={step._id}
            step={step}
            index={index}
            onUpdate={updateStep}
            onRemove={removeStep}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !name || steps.length === 0}>
          {saving ? 'Saving...' : 'Save Sequence'}
        </Button>
      </div>
    </div>
  )
}
