// AUTO-GENERATED from the Supabase schema (prod). Do not edit by hand;
// regenerate via `supabase gen types` / the MCP generator.
/* eslint-disable */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          contact_id: string | null
          created_at: string
          id: string
          metadata: Json | null
          organization_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          organization_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_drafts: {
        Row: {
          available_after: string | null
          channel: string
          contact_id: string
          context_snapshot: Json | null
          draft_body: string
          draft_subject: string | null
          edit_distance: number | null
          generated_at: string
          guardrail_violation: string | null
          id: string
          model: string
          organization_id: string
          rejection_reason: string | null
          resolved_at: string | null
          sent_message_id: string | null
          state: string
          trigger_message_id: string | null
        }
        Insert: {
          available_after?: string | null
          channel: string
          contact_id: string
          context_snapshot?: Json | null
          draft_body: string
          draft_subject?: string | null
          edit_distance?: number | null
          generated_at?: string
          guardrail_violation?: string | null
          id?: string
          model: string
          organization_id: string
          rejection_reason?: string | null
          resolved_at?: string | null
          sent_message_id?: string | null
          state?: string
          trigger_message_id?: string | null
        }
        Update: {
          available_after?: string | null
          channel?: string
          contact_id?: string
          context_snapshot?: Json | null
          draft_body?: string
          draft_subject?: string | null
          edit_distance?: number | null
          generated_at?: string
          guardrail_violation?: string | null
          id?: string
          model?: string
          organization_id?: string
          rejection_reason?: string | null
          resolved_at?: string | null
          sent_message_id?: string | null
          state?: string
          trigger_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_drafts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_sent_message_id_fkey"
            columns: ["sent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_trigger_message_id_fkey"
            columns: ["trigger_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_sequences: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          trigger_stage_id: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          trigger_stage_id?: string | null
          trigger_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          trigger_stage_id?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_sequences_trigger_stage_id_fkey"
            columns: ["trigger_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_overrides: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          id: string
          kind: string
          organization_id: string
          provider_id: string | null
          reason: string | null
          start_time: string | null
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          kind: string
          organization_id: string
          provider_id?: string | null
          reason?: string | null
          start_time?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          kind?: string
          organization_id?: string
          provider_id?: string | null
          reason?: string | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_overrides_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          created_at: string
          end_time: string
          id: string
          organization_id: string
          provider_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          organization_id: string
          provider_id: string
          start_time: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          organization_id?: string
          provider_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_rules_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          call_sid: string
          contact_id: string | null
          created_at: string
          detected_language: string | null
          direction: string
          duration_sec: number | null
          ended_at: string | null
          followup_summary: string | null
          from_e164: string
          id: string
          intent: string | null
          is_urgent: boolean
          organization_id: string
          outcome: string
          recording_consent_obtained: boolean
          recording_url: string | null
          safety_trigger_label: string | null
          started_at: string
          to_e164: string
          transcript: Json | null
          urgency_reason: string | null
        }
        Insert: {
          call_sid: string
          contact_id?: string | null
          created_at?: string
          detected_language?: string | null
          direction: string
          duration_sec?: number | null
          ended_at?: string | null
          followup_summary?: string | null
          from_e164: string
          id?: string
          intent?: string | null
          is_urgent?: boolean
          organization_id: string
          outcome?: string
          recording_consent_obtained?: boolean
          recording_url?: string | null
          safety_trigger_label?: string | null
          started_at?: string
          to_e164: string
          transcript?: Json | null
          urgency_reason?: string | null
        }
        Update: {
          call_sid?: string
          contact_id?: string | null
          created_at?: string
          detected_language?: string | null
          direction?: string
          duration_sec?: number | null
          ended_at?: string | null
          followup_summary?: string | null
          from_e164?: string
          id?: string
          intent?: string | null
          is_urgent?: boolean
          organization_id?: string
          outcome?: string
          recording_consent_obtained?: boolean
          recording_url?: string | null
          safety_trigger_label?: string | null
          started_at?: string
          to_e164?: string
          transcript?: Json | null
          urgency_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultations: {
        Row: {
          assigned_to: string | null
          booked_via: string
          cancel_reason: string | null
          contact_id: string
          created_at: string
          duration_min: number
          end_at: string | null
          held_until: string | null
          hold_token: string | null
          id: string
          no_show_recovery_sent_at: string | null
          organization_id: string
          post_consult_notes: string | null
          pre_consult_notes: string | null
          procedure_discussed: string[] | null
          provider_id: string | null
          reminder_24h_sent: boolean
          reminder_2h_sent: boolean
          scheduled_at: string
          service_id: string | null
          status: string
          time_range: unknown
          type: string
          updated_at: string
          voice_reminder_call_sid: string | null
          voice_reminder_sent_at: string | null
          voice_reminder_status: string
        }
        Insert: {
          assigned_to?: string | null
          booked_via?: string
          cancel_reason?: string | null
          contact_id: string
          created_at?: string
          duration_min?: number
          end_at?: string | null
          held_until?: string | null
          hold_token?: string | null
          id?: string
          no_show_recovery_sent_at?: string | null
          organization_id: string
          post_consult_notes?: string | null
          pre_consult_notes?: string | null
          procedure_discussed?: string[] | null
          provider_id?: string | null
          reminder_24h_sent?: boolean
          reminder_2h_sent?: boolean
          scheduled_at: string
          service_id?: string | null
          status?: string
          time_range?: unknown
          type?: string
          updated_at?: string
          voice_reminder_call_sid?: string | null
          voice_reminder_sent_at?: string | null
          voice_reminder_status?: string
        }
        Update: {
          assigned_to?: string | null
          booked_via?: string
          cancel_reason?: string | null
          contact_id?: string
          created_at?: string
          duration_min?: number
          end_at?: string | null
          held_until?: string | null
          hold_token?: string | null
          id?: string
          no_show_recovery_sent_at?: string | null
          organization_id?: string
          post_consult_notes?: string | null
          pre_consult_notes?: string | null
          procedure_discussed?: string[] | null
          provider_id?: string | null
          reminder_24h_sent?: boolean
          reminder_2h_sent?: boolean
          scheduled_at?: string
          service_id?: string | null
          status?: string
          time_range?: unknown
          type?: string
          updated_at?: string
          voice_reminder_call_sid?: string | null
          voice_reminder_sent_at?: string | null
          voice_reminder_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_imports: {
        Row: {
          completed_at: string | null
          error_log: Json | null
          id: string
          imported_count: number
          organization_id: string
          row_count: number
          skipped_count: number
          source: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          error_log?: Json | null
          id?: string
          imported_count?: number
          organization_id: string
          row_count?: number
          skipped_count?: number
          source: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          error_log?: Json | null
          id?: string
          imported_count?: number
          organization_id?: string
          row_count?: number
          skipped_count?: number
          source?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_sequence_enrollments: {
        Row: {
          completed_at: string | null
          contact_id: string
          current_step: number
          enrolled_at: string
          id: string
          next_step_at: string | null
          organization_id: string
          sequence_id: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          current_step?: number
          enrolled_at?: string
          id?: string
          next_step_at?: string | null
          organization_id: string
          sequence_id: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          current_step?: number
          enrolled_at?: string
          id?: string
          next_step_at?: string | null
          organization_id?: string
          sequence_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_sequence_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_sequence_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_sequence_enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "automation_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          tag_id: string
        }
        Insert: {
          contact_id: string
          tag_id: string
        }
        Update: {
          contact_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          date_of_birth: string | null
          deleted_at: string | null
          email: string | null
          first_name: string
          id: string
          import_id: string | null
          is_archived: boolean
          last_activity_at: string | null
          last_contacted_at: string | null
          last_name: string | null
          messages_last_seen_at: string | null
          notes: string | null
          opted_out_at: string | null
          opted_out_email: boolean
          opted_out_sms: boolean
          organization_id: string
          phone: string | null
          preferred_language: string | null
          procedure_interest: string[] | null
          sms_consent: boolean
          sms_consent_at: string | null
          source: string | null
          stage_id: string | null
          status: string
          updated_at: string
          voice_recording_consent: boolean | null
          voice_recording_consent_at: string | null
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          import_id?: string | null
          is_archived?: boolean
          last_activity_at?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          messages_last_seen_at?: string | null
          notes?: string | null
          opted_out_at?: string | null
          opted_out_email?: boolean
          opted_out_sms?: boolean
          organization_id: string
          phone?: string | null
          preferred_language?: string | null
          procedure_interest?: string[] | null
          sms_consent?: boolean
          sms_consent_at?: string | null
          source?: string | null
          stage_id?: string | null
          status?: string
          updated_at?: string
          voice_recording_consent?: boolean | null
          voice_recording_consent_at?: string | null
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          import_id?: string | null
          is_archived?: boolean
          last_activity_at?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          messages_last_seen_at?: string | null
          notes?: string | null
          opted_out_at?: string | null
          opted_out_email?: boolean
          opted_out_sms?: boolean
          organization_id?: string
          phone?: string | null
          preferred_language?: string | null
          procedure_interest?: string[] | null
          sms_consent?: boolean
          sms_consent_at?: string | null
          source?: string | null
          stage_id?: string | null
          status?: string
          updated_at?: string
          voice_recording_consent?: boolean | null
          voice_recording_consent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "contact_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_locks: {
        Row: {
          lock_key: string
          locked_at: string
          locked_by: string | null
          locked_until: string
        }
        Insert: {
          lock_key: string
          locked_at?: string
          locked_by?: string | null
          locked_until: string
        }
        Update: {
          lock_key?: string
          locked_at?: string
          locked_by?: string | null
          locked_until?: string
        }
        Relationships: []
      }
      demo_prospects: {
        Row: {
          address: string | null
          city: string | null
          clinic_name: string
          created_at: string
          id: string
          notes: string | null
          services: string[] | null
          slug: string
          vapi_assistant_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          clinic_name: string
          created_at?: string
          id?: string
          notes?: string | null
          services?: string[] | null
          slug: string
          vapi_assistant_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          clinic_name?: string
          created_at?: string
          id?: string
          notes?: string | null
          services?: string[] | null
          slug?: string
          vapi_assistant_id?: string
          website?: string | null
        }
        Relationships: []
      }
      demo_requests: {
        Row: {
          clinic_name: string
          created_at: string
          email: string
          id: string
          name: string
          notes: string | null
          page_path: string | null
          phone: string | null
          preferred_date: string | null
          preferred_time: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          clinic_name: string
          created_at?: string
          email: string
          id?: string
          name: string
          notes?: string | null
          page_path?: string | null
          phone?: string | null
          preferred_date?: string | null
          preferred_time?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          clinic_name?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          notes?: string | null
          page_path?: string | null
          phone?: string | null
          preferred_date?: string | null
          preferred_time?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      enrollment_jobs: {
        Row: {
          attempts: number
          contact_id: string
          created_at: string
          id: string
          last_error: string | null
          organization_id: string
          processed_at: string | null
          scheduled_at: string
          stage_id: string | null
          status: string
          trigger_type: string
        }
        Insert: {
          attempts?: number
          contact_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          organization_id: string
          processed_at?: string | null
          scheduled_at?: string
          stage_id?: string | null
          status?: string
          trigger_type: string
        }
        Update: {
          attempts?: number
          contact_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          organization_id?: string
          processed_at?: string | null
          scheduled_at?: string
          stage_id?: string | null
          status?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_jobs_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_line_items: {
        Row: {
          created_at: string
          description: string
          estimate_id: string
          id: string
          organization_id: string
          position: number
          quantity: number
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          description: string
          estimate_id: string
          id?: string
          organization_id: string
          position?: number
          quantity?: number
          unit_price_cents?: number
        }
        Update: {
          created_at?: string
          description?: string
          estimate_id?: string
          id?: string
          organization_id?: string
          position?: number
          quantity?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_line_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          approved_at: string | null
          approved_ip: string | null
          contact_id: string
          created_at: string
          created_by: string | null
          currency: string
          estimate_number: number
          id: string
          notes: string | null
          organization_id: string
          sent_at: string | null
          status: string
          subtotal_cents: number
          tax_cents: number
          title: string | null
          total_cents: number
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_ip?: string | null
          contact_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          estimate_number: number
          id?: string
          notes?: string | null
          organization_id: string
          sent_at?: string | null
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          title?: string | null
          total_cents?: number
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_ip?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          estimate_number?: number
          id?: string
          notes?: string | null
          organization_id?: string
          sent_at?: string | null
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          title?: string | null
          total_cents?: number
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimates_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_throttle: {
        Row: {
          attempted_at: string
          email: string
          id: string
          organization_id: string | null
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: string
          organization_id?: string | null
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitation_throttle_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          organization_id: string
          position: number
          quantity: number
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          organization_id: string
          position?: number
          quantity?: number
          unit_price_cents?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          position?: number
          quantity?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid_cents: number
          contact_id: string
          created_at: string
          created_by: string | null
          currency: string
          estimate_id: string | null
          id: string
          invoice_number: number
          job_id: string | null
          notes: string | null
          organization_id: string
          paid_at: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          tax_cents: number
          title: string | null
          total_cents: number
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          amount_paid_cents?: number
          contact_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          estimate_id?: string | null
          id?: string
          invoice_number: number
          job_id?: string | null
          notes?: string | null
          organization_id: string
          paid_at?: string | null
          sent_at?: string | null
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          title?: string | null
          total_cents?: number
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          amount_paid_cents?: number
          contact_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          estimate_id?: string | null
          id?: string
          invoice_number?: number
          job_id?: string | null
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          sent_at?: string | null
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          title?: string | null
          total_cents?: number
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          completed_at: string | null
          contact_id: string
          created_at: string
          estimate_id: string | null
          id: string
          notes: string | null
          organization_id: string
          scheduled_date: string | null
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          created_at?: string
          estimate_id?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          scheduled_date?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          estimate_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          scheduled_date?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          channel: string
          contact_id: string | null
          created_at: string
          delivered_at: string | null
          direction: string
          error_message: string | null
          from_address: string | null
          id: string
          opened_at: string | null
          organization_id: string
          provider_id: string | null
          sent_at: string | null
          sequence_step_id: string | null
          status: string
          subject: string | null
          to_address: string
        }
        Insert: {
          body: string
          channel: string
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          from_address?: string | null
          id?: string
          opened_at?: string | null
          organization_id: string
          provider_id?: string | null
          sent_at?: string | null
          sequence_step_id?: string | null
          status?: string
          subject?: string | null
          to_address: string
        }
        Update: {
          body?: string
          channel?: string
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          from_address?: string | null
          id?: string
          opened_at?: string | null
          organization_id?: string
          provider_id?: string | null
          sent_at?: string | null
          sequence_step_id?: string | null
          status?: string
          subject?: string | null
          to_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sequence_step_id_fkey"
            columns: ["sequence_step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          consultation_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          is_read: boolean
          organization_id: string
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          consultation_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          organization_id: string
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          consultation_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          organization_id?: string
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_counters: {
        Row: {
          kind: string
          next_val: number
          organization_id: string
        }
        Insert: {
          kind: string
          next_val?: number
          organization_id: string
        }
        Update: {
          kind?: string
          next_val?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          a2p_brand_data: Json | null
          a2p_brand_sid: string | null
          a2p_campaign_sid: string | null
          a2p_status: string
          a2p_status_updated_at: string | null
          address_line1: string | null
          address_line2: string | null
          admin_notes: string | null
          ai_twin_auto_send_classes: string[]
          ai_twin_auto_send_enabled: boolean
          ai_twin_auto_send_rollout_pct: number
          ai_twin_auto_send_shadow_mode: boolean
          ai_twin_enabled: boolean
          ai_twin_quiet_hours_end: string | null
          ai_twin_quiet_hours_start: string | null
          ai_twin_voice_profile: Json
          booking_enabled: boolean
          call_agent_assistant_id: string | null
          call_agent_baa_attested_at: string | null
          call_agent_business_hours: Json | null
          call_agent_enabled: boolean
          call_agent_fallback_e164: string | null
          call_agent_greeting: string | null
          call_agent_mode: string
          call_agent_reminder_assistant_id: string | null
          call_agent_voice_id: string | null
          caller_languages: string[]
          canceled_at: string | null
          city: string | null
          connect_charges_enabled: boolean
          connect_onboarded_at: string | null
          connect_payouts_enabled: boolean
          country_code: string | null
          created_at: string
          directions_notes: string | null
          email: string | null
          faqs: Json
          google_place_id: string | null
          id: string
          intake_form_url: string | null
          name: string
          notification_channel: string
          owner_language: string
          owner_notify_e164: string | null
          phone: string | null
          phone_number_monthly_cost_cents: number
          phone_number_purchased_at: string | null
          plan: string
          plan_status: string
          postal_code: string | null
          procedures: string[] | null
          region: string | null
          slug: string
          sms_confirmation_enabled: boolean
          sms_enabled: boolean
          sms_reminder_24h_enabled: boolean
          sms_reminder_2h_enabled: boolean
          sms_template_confirmation: string | null
          sms_template_confirmation_es: string | null
          sms_template_reminder_24h: string | null
          sms_template_reminder_2h: string | null
          stripe_connect_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          timezone: string
          trial_ends_at: string | null
          trial_expired_email_sent_at: string | null
          trial_reminder_1d_sent_at: string | null
          trial_reminder_3d_sent_at: string | null
          trial_reminder_7d_sent_at: string | null
          trial_winback_sent_at: string | null
          twilio_phone_number: string | null
          twilio_phone_sid: string | null
          updated_at: string
          vapi_phone_number_id: string | null
          vertical: string
          voice_reminder_consent_attested_at: string | null
          voice_reminder_enabled: boolean
          voice_reminder_lead_hours: number
          website: string | null
          weekly_digest_enabled: boolean
          weekly_digest_last_sent_at: string | null
          whatsapp_last_inbound_at: string | null
          winback_sent_at: string | null
        }
        Insert: {
          a2p_brand_data?: Json | null
          a2p_brand_sid?: string | null
          a2p_campaign_sid?: string | null
          a2p_status?: string
          a2p_status_updated_at?: string | null
          address_line1?: string | null
          address_line2?: string | null
          admin_notes?: string | null
          ai_twin_auto_send_classes?: string[]
          ai_twin_auto_send_enabled?: boolean
          ai_twin_auto_send_rollout_pct?: number
          ai_twin_auto_send_shadow_mode?: boolean
          ai_twin_enabled?: boolean
          ai_twin_quiet_hours_end?: string | null
          ai_twin_quiet_hours_start?: string | null
          ai_twin_voice_profile?: Json
          booking_enabled?: boolean
          call_agent_assistant_id?: string | null
          call_agent_baa_attested_at?: string | null
          call_agent_business_hours?: Json | null
          call_agent_enabled?: boolean
          call_agent_fallback_e164?: string | null
          call_agent_greeting?: string | null
          call_agent_mode?: string
          call_agent_reminder_assistant_id?: string | null
          call_agent_voice_id?: string | null
          caller_languages?: string[]
          canceled_at?: string | null
          city?: string | null
          connect_charges_enabled?: boolean
          connect_onboarded_at?: string | null
          connect_payouts_enabled?: boolean
          country_code?: string | null
          created_at?: string
          directions_notes?: string | null
          email?: string | null
          faqs?: Json
          google_place_id?: string | null
          id?: string
          intake_form_url?: string | null
          name: string
          notification_channel?: string
          owner_language?: string
          owner_notify_e164?: string | null
          phone?: string | null
          phone_number_monthly_cost_cents?: number
          phone_number_purchased_at?: string | null
          plan?: string
          plan_status?: string
          postal_code?: string | null
          procedures?: string[] | null
          region?: string | null
          slug: string
          sms_confirmation_enabled?: boolean
          sms_enabled?: boolean
          sms_reminder_24h_enabled?: boolean
          sms_reminder_2h_enabled?: boolean
          sms_template_confirmation?: string | null
          sms_template_confirmation_es?: string | null
          sms_template_reminder_24h?: string | null
          sms_template_reminder_2h?: string | null
          stripe_connect_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          timezone?: string
          trial_ends_at?: string | null
          trial_expired_email_sent_at?: string | null
          trial_reminder_1d_sent_at?: string | null
          trial_reminder_3d_sent_at?: string | null
          trial_reminder_7d_sent_at?: string | null
          trial_winback_sent_at?: string | null
          twilio_phone_number?: string | null
          twilio_phone_sid?: string | null
          updated_at?: string
          vapi_phone_number_id?: string | null
          vertical?: string
          voice_reminder_consent_attested_at?: string | null
          voice_reminder_enabled?: boolean
          voice_reminder_lead_hours?: number
          website?: string | null
          weekly_digest_enabled?: boolean
          weekly_digest_last_sent_at?: string | null
          whatsapp_last_inbound_at?: string | null
          winback_sent_at?: string | null
        }
        Update: {
          a2p_brand_data?: Json | null
          a2p_brand_sid?: string | null
          a2p_campaign_sid?: string | null
          a2p_status?: string
          a2p_status_updated_at?: string | null
          address_line1?: string | null
          address_line2?: string | null
          admin_notes?: string | null
          ai_twin_auto_send_classes?: string[]
          ai_twin_auto_send_enabled?: boolean
          ai_twin_auto_send_rollout_pct?: number
          ai_twin_auto_send_shadow_mode?: boolean
          ai_twin_enabled?: boolean
          ai_twin_quiet_hours_end?: string | null
          ai_twin_quiet_hours_start?: string | null
          ai_twin_voice_profile?: Json
          booking_enabled?: boolean
          call_agent_assistant_id?: string | null
          call_agent_baa_attested_at?: string | null
          call_agent_business_hours?: Json | null
          call_agent_enabled?: boolean
          call_agent_fallback_e164?: string | null
          call_agent_greeting?: string | null
          call_agent_mode?: string
          call_agent_reminder_assistant_id?: string | null
          call_agent_voice_id?: string | null
          caller_languages?: string[]
          canceled_at?: string | null
          city?: string | null
          connect_charges_enabled?: boolean
          connect_onboarded_at?: string | null
          connect_payouts_enabled?: boolean
          country_code?: string | null
          created_at?: string
          directions_notes?: string | null
          email?: string | null
          faqs?: Json
          google_place_id?: string | null
          id?: string
          intake_form_url?: string | null
          name?: string
          notification_channel?: string
          owner_language?: string
          owner_notify_e164?: string | null
          phone?: string | null
          phone_number_monthly_cost_cents?: number
          phone_number_purchased_at?: string | null
          plan?: string
          plan_status?: string
          postal_code?: string | null
          procedures?: string[] | null
          region?: string | null
          slug?: string
          sms_confirmation_enabled?: boolean
          sms_enabled?: boolean
          sms_reminder_24h_enabled?: boolean
          sms_reminder_2h_enabled?: boolean
          sms_template_confirmation?: string | null
          sms_template_confirmation_es?: string | null
          sms_template_reminder_24h?: string | null
          sms_template_reminder_2h?: string | null
          stripe_connect_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          timezone?: string
          trial_ends_at?: string | null
          trial_expired_email_sent_at?: string | null
          trial_reminder_1d_sent_at?: string | null
          trial_reminder_3d_sent_at?: string | null
          trial_reminder_7d_sent_at?: string | null
          trial_winback_sent_at?: string | null
          twilio_phone_number?: string | null
          twilio_phone_sid?: string | null
          updated_at?: string
          vapi_phone_number_id?: string | null
          vertical?: string
          voice_reminder_consent_attested_at?: string | null
          voice_reminder_enabled?: boolean
          voice_reminder_lead_hours?: number
          website?: string | null
          weekly_digest_enabled?: boolean
          weekly_digest_last_sent_at?: string | null
          whatsapp_last_inbound_at?: string | null
          winback_sent_at?: string | null
        }
        Relationships: []
      }
      password_reset_throttle: {
        Row: {
          attempted_at: string
          email: string
          id: string
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: string
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_cents: number
          application_fee_cents: number | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string
          method: string
          note: string | null
          organization_id: string
          status: string
          stripe_payment_intent: string | null
        }
        Insert: {
          amount_cents: number
          application_fee_cents?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          method: string
          note?: string | null
          organization_id: string
          status?: string
          stripe_payment_intent?: string | null
        }
        Update: {
          amount_cents?: number
          application_fee_cents?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          method?: string
          note?: string | null
          organization_id?: string
          status?: string
          stripe_payment_intent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          organization_id: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          is_super_admin: boolean
          organization_id: string
          role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          is_super_admin?: boolean
          organization_id: string
          role?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          is_super_admin?: boolean
          organization_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          buffer_after_min: number
          buffer_before_min: number
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          organization_id: string
          photo_url: string | null
          profile_id: string | null
          role_label: string | null
          updated_at: string
        }
        Insert: {
          buffer_after_min?: number
          buffer_before_min?: number
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          organization_id: string
          photo_url?: string | null
          profile_id?: string | null
          role_label?: string | null
          updated_at?: string
        }
        Update: {
          buffer_after_min?: number
          buffer_before_min?: number
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          photo_url?: string | null
          profile_id?: string | null
          role_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "providers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provisioning_jobs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          organization_id: string
          payload: Json | null
          status: string
          step: string
          succeeded_at: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          organization_id: string
          payload?: Json | null
          status?: string
          step: string
          succeeded_at?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          organization_id?: string
          payload?: Json | null
          status?: string
          step?: string
          succeeded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provisioning_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          body: string
          channel: string
          created_at: string
          delay_hours: number
          id: string
          position: number
          sequence_id: string
          subject: string | null
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          delay_hours?: number
          id?: string
          position?: number
          sequence_id: string
          subject?: string | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          delay_hours?: number
          id?: string
          position?: number
          sequence_id?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "automation_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      service_providers: {
        Row: {
          created_at: string
          organization_id: string
          provider_id: string
          service_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          provider_id: string
          service_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          provider_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_providers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_providers_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_providers_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          booking_horizon_days: number
          color: string | null
          created_at: string
          description: string | null
          duration_min: number
          id: string
          is_active: boolean
          is_bookable_online: boolean
          lead_time_hours: number
          name: string
          organization_id: string
          position: number
          pre_visit_instructions: string | null
          price_cents: number | null
          updated_at: string
        }
        Insert: {
          booking_horizon_days?: number
          color?: string | null
          created_at?: string
          description?: string | null
          duration_min: number
          id?: string
          is_active?: boolean
          is_bookable_online?: boolean
          lead_time_hours?: number
          name: string
          organization_id: string
          position?: number
          pre_visit_instructions?: string | null
          price_cents?: number | null
          updated_at?: string
        }
        Update: {
          booking_horizon_days?: number
          color?: string | null
          created_at?: string
          description?: string | null
          duration_min?: number
          id?: string
          is_active?: boolean
          is_bookable_online?: boolean
          lead_time_hours?: number
          name?: string
          organization_id?: string
          position?: number
          pre_visit_instructions?: string | null
          price_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_log: {
        Row: {
          body: string
          consultation_id: string | null
          contact_id: string | null
          error_message: string | null
          id: string
          message_type: string
          organization_id: string | null
          provider_id: string | null
          sent_at: string
          status: string
          to_number: string
        }
        Insert: {
          body: string
          consultation_id?: string | null
          contact_id?: string | null
          error_message?: string | null
          id?: string
          message_type: string
          organization_id?: string | null
          provider_id?: string | null
          sent_at?: string
          status: string
          to_number: string
        }
        Update: {
          body?: string
          consultation_id?: string | null
          contact_id?: string | null
          error_message?: string | null
          id?: string
          message_type?: string
          organization_id?: string | null
          provider_id?: string | null
          sent_at?: string
          status?: string
          to_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_log_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          last_resent_at: string | null
          organization_id: string
          resend_count: number
          revoked_at: string | null
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          last_resent_at?: string | null
          organization_id: string
          resend_count?: number
          revoked_at?: string | null
          role: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          last_resent_at?: string | null
          organization_id?: string
          resend_count?: number
          revoked_at?: string | null
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          billing_period_end: string | null
          billing_period_start: string | null
          created_at: string
          id: string
          kind: string
          organization_id: string
          quantity: number
          reported_to_stripe_at: string | null
          source_ref: string | null
          stripe_usage_record_id: string | null
        }
        Insert: {
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string
          id?: string
          kind: string
          organization_id: string
          quantity: number
          reported_to_stripe_at?: string | null
          source_ref?: string | null
          stripe_usage_record_id?: string | null
        }
        Update: {
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string
          id?: string
          kind?: string
          organization_id?: string
          quantity?: number
          reported_to_stripe_at?: string | null
          source_ref?: string | null
          stripe_usage_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_examples: {
        Row: {
          body: string
          class: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          body: string
          class: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          class?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_examples_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_messages: {
        Row: {
          call_sid: string | null
          callback_preference: string
          caller_name: string
          caller_phone: string | null
          contact_id: string | null
          created_at: string
          id: string
          message_text: string
          organization_id: string
          status: string
          updated_at: string
          urgency: string
        }
        Insert: {
          call_sid?: string | null
          callback_preference?: string
          caller_name: string
          caller_phone?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          message_text: string
          organization_id: string
          status?: string
          updated_at?: string
          urgency?: string
        }
        Update: {
          call_sid?: string | null
          callback_preference?: string
          caller_name?: string
          caller_phone?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          message_text?: string
          organization_id?: string
          status?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      contacts_active: {
        Row: {
          created_at: string | null
          date_of_birth: string | null
          deleted_at: string | null
          email: string | null
          first_name: string | null
          id: string | null
          import_id: string | null
          is_archived: boolean | null
          last_activity_at: string | null
          last_contacted_at: string | null
          last_name: string | null
          messages_last_seen_at: string | null
          notes: string | null
          opted_out_at: string | null
          opted_out_email: boolean | null
          opted_out_sms: boolean | null
          organization_id: string | null
          phone: string | null
          procedure_interest: string[] | null
          sms_consent: boolean | null
          source: string | null
          stage_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string | null
          import_id?: string | null
          is_archived?: boolean | null
          last_activity_at?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          messages_last_seen_at?: string | null
          notes?: string | null
          opted_out_at?: string | null
          opted_out_email?: boolean | null
          opted_out_sms?: boolean | null
          organization_id?: string | null
          phone?: string | null
          procedure_interest?: string[] | null
          sms_consent?: boolean | null
          source?: string | null
          stage_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string | null
          import_id?: string | null
          is_archived?: boolean | null
          last_activity_at?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          messages_last_seen_at?: string | null
          notes?: string | null
          opted_out_at?: string | null
          opted_out_email?: boolean | null
          opted_out_sms?: boolean | null
          organization_id?: string | null
          phone?: string | null
          procedure_interest?: string[] | null
          sms_consent?: boolean | null
          source?: string | null
          stage_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "contact_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      bulk_insert_contacts_ignore_dupes: {
        Args: { p_import_id: string; p_org_id: string; p_rows: Json }
        Returns: {
          inserted_count: number
          skipped_count: number
        }[]
      }
      current_org_id: { Args: never; Returns: string }
      next_document_number: {
        Args: { p_kind: string; p_org: string }
        Returns: number
      }
      release_cron_lock: { Args: { p_key: string }; Returns: undefined }
      seed_default_stages: { Args: { org_id: string }; Returns: undefined }
      seed_stages_for_vertical: {
        Args: { org_id: string; p_vertical?: string }
        Returns: undefined
      }
      set_sms_opt_out_by_phone_suffix: {
        Args: { p_opt_out: boolean; p_phone_suffix: string }
        Returns: number
      }
      try_cron_lock: {
        Args: { p_key: string; p_ttl_seconds: number }
        Returns: boolean
      }
      tz_minute_bucket: { Args: { ts: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
