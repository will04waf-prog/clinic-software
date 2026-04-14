// ============================================================
// Tarhunna – Core Types
// ============================================================

export type Plan = 'trial' | 'starter' | 'pro'
export type PlanStatus = 'active' | 'past_due' | 'canceled'
export type UserRole = 'owner' | 'admin' | 'staff'
export type ContactStatus = 'lead' | 'patient' | 'inactive'
export type ConsultationStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'canceled' | 'rescheduled'
export type ConsultationType = 'in_person' | 'virtual'
export type MessageChannel = 'email' | 'sms'
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'opened'
export type MessageDirection = 'outbound' | 'inbound'
export type SequenceStatus = 'active' | 'paused' | 'completed' | 'canceled'
export type TriggerType =
  | 'new_lead'
  | 'stage_changed'
  | 'no_show'
  | 'old_lead_reactivation'
  | 'consultation_booked'
  | 'consultation_completed'
export type NotificationType =
  | 'new_lead'
  | 'no_show'
  | 'consultation_reminder'
  | 'old_lead_triggered'
  | 'reply_received'

export type LeadSource = 'website' | 'referral' | 'instagram' | 'facebook' | 'walkin' | 'other'

// Procedure presets by clinic type.
// To switch defaults, change the PROCEDURES export below.
export const PROCEDURE_PRESETS = {
  med_spa: [
    'botox',
    'fillers',
    'lip_filler',
    'chemical_peel',
    'microneedling',
    'laser_hair_removal',
    'hydrafacial',
    'skin_tightening',
    'prp',
    'body_contouring',
    'weight_loss',
    'other',
  ],
  plastic_surgery: [
    'rhinoplasty',
    'bbl',
    'liposuction',
    'breast_augmentation',
    'breast_reduction',
    'tummy_tuck',
    'facelift',
    'blepharoplasty',
    'botox',
    'fillers',
    'other',
  ],
} as const

export const PROCEDURES = PROCEDURE_PRESETS.med_spa

export type Procedure = typeof PROCEDURES[number]

// ============================================================
// Database Row Types
// ============================================================

export interface Organization {
  id: string
  name: string
  slug: string
  phone: string | null
  email: string | null
  website: string | null
  timezone: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: Plan
  plan_status: PlanStatus
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  organization_id: string
  full_name: string
  email: string
  role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface PipelineStage {
  id: string
  organization_id: string
  name: string
  color: string
  position: number
  is_default: boolean
  created_at: string
}

export interface Tag {
  id: string
  organization_id: string
  name: string
  color: string
  created_at: string
}

export interface Contact {
  id: string
  organization_id: string
  stage_id: string | null
  first_name: string
  last_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
  source: LeadSource | null
  procedure_interest: Procedure[] | null
  status: ContactStatus
  is_archived: boolean
  opted_out_sms: boolean
  opted_out_email: boolean
  notes: string | null
  last_contacted_at: string | null
  last_activity_at: string | null
  created_at: string
  updated_at: string
  // Joined fields
  stage?: PipelineStage
  tags?: Tag[]
}

export interface Consultation {
  id: string
  organization_id: string
  contact_id: string
  assigned_to: string | null
  scheduled_at: string
  duration_min: number
  type: ConsultationType
  status: ConsultationStatus
  procedure_discussed: Procedure[] | null
  pre_consult_notes: string | null
  post_consult_notes: string | null
  reminder_24h_sent: boolean
  reminder_2h_sent: boolean
  created_at: string
  updated_at: string
  // Joined fields
  contact?: Contact
  assignee?: Profile
}

export interface AutomationSequence {
  id: string
  organization_id: string
  name: string
  trigger_type: TriggerType
  trigger_stage_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  // Joined fields
  steps?: SequenceStep[]
}

export interface SequenceStep {
  id: string
  sequence_id: string
  position: number
  delay_hours: number
  channel: MessageChannel
  subject: string | null
  body: string
  created_at: string
}

export interface ContactSequenceEnrollment {
  id: string
  contact_id: string
  sequence_id: string
  organization_id: string
  status: SequenceStatus
  current_step: number
  next_step_at: string | null
  enrolled_at: string
  completed_at: string | null
}

export interface Message {
  id: string
  organization_id: string
  contact_id: string | null
  sequence_step_id: string | null
  channel: MessageChannel
  direction: MessageDirection
  status: MessageStatus
  subject: string | null
  body: string
  to_address: string
  from_address: string | null
  provider_id: string | null
  error_message: string | null
  sent_at: string | null
  opened_at: string | null
  delivered_at: string | null
  created_at: string
}

export interface Notification {
  id: string
  organization_id: string
  user_id: string | null
  type: NotificationType
  title: string
  body: string | null
  contact_id: string | null
  consultation_id: string | null
  is_read: boolean
  created_at: string
}

export interface ActivityLog {
  id: string
  organization_id: string
  contact_id: string | null
  user_id: string | null
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
}

// ============================================================
// UI / Form Types
// ============================================================

export interface DashboardStats {
  new_leads_today: number
  new_leads_week: number
  consultations_today: number
  consultations_week: number
  no_shows_week: number
  conversion_rate: number
  total_active_leads: number
  total_contacts: number
}

export interface PipelineColumn {
  stage: PipelineStage
  contacts: Contact[]
  count: number
}

export interface CreateContactInput {
  first_name: string
  last_name?: string
  email?: string
  phone?: string
  source?: LeadSource
  procedure_interest?: Procedure[]
  notes?: string
  stage_id?: string
}

export interface CreateConsultationInput {
  contact_id: string
  scheduled_at: string
  duration_min?: number
  type?: ConsultationType
  assigned_to?: string
  pre_consult_notes?: string
}

export interface LeadCaptureFormData {
  first_name: string
  last_name?: string
  email?: string
  phone?: string
  procedure_interest?: string[]
  notes?: string
  source?: string
}
