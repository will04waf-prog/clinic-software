import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Mail, Phone, Calendar, Tag, MessageSquare, Activity } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { BookConsultationDialog } from '@/components/consultations/book-consultation-dialog'
import { SendEmailDialog } from '@/components/leads/send-email-dialog'
import { SendSmsDialog } from '@/components/leads/send-sms-dialog'
import { LeadSummaryCard } from '@/components/leads/lead-summary-card'
import { formatDate, formatDateTime, formatRelative, formatPhone, formatProcedure, formatLeadSource } from '@/lib/utils'
import type { Contact, Message, ActivityLog, Consultation } from '@/types'

async function getContactData(id: string) {
  const supabase = await createClient()

  const [
    { data: contact },
    { data: messages },
    { data: activity },
    { data: consultations },
  ] = await Promise.all([
    supabase
      .from('contacts_active')
      .select('*, stage:pipeline_stages(*), tags:contact_tags(tag:tags(*))')
      .eq('id', id)
      .single(),
    supabase
      .from('messages')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('activity_log')
      .select('*, user:profiles(full_name)')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('consultations')
      .select('*, assignee:profiles(full_name)')
      .eq('contact_id', id)
      .order('scheduled_at', { ascending: false }),
  ])

  // Mark the conversation as seen. Fire-and-forget: a failure here
  // shouldn't break page render — the indicator will just persist until
  // the next view. RLS scopes the update to the caller's org.
  if (contact) {
    void supabase
      .from('contacts')
      .update({ messages_last_seen_at: new Date().toISOString() })
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.error('[leads/[id]] mark-as-seen failed:', error.message)
      })
  }

  return { contact, messages: messages ?? [], activity: activity ?? [], consultations: consultations ?? [] }
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { contact, messages, activity, consultations } = await getContactData(id)

  if (!contact) notFound()

  const tags = (contact.tags ?? []).map((t: any) => t.tag).filter(Boolean)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={`${contact.first_name} ${contact.last_name ?? ''}`}
        subtitle={contact.email ?? contact.phone ?? 'No contact info'}
        actions={
          <div className="flex items-center gap-2">
            <SendSmsDialog
              contactId={contact.id}
              contactPhone={contact.phone ?? null}
              firstName={contact.first_name}
              smsConsent={contact.sms_consent === true}
              optedOutSms={contact.opted_out_sms === true}
            />
            <SendEmailDialog
              contactId={contact.id}
              contactEmail={contact.email ?? null}
              firstName={contact.first_name}
            />
            <Link href="/leads">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <LeadSummaryCard contactId={contact.id} className="mb-6" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column: contact info */}
          <div className="space-y-4 lg:col-span-1">
            {/* Profile card */}
            <Card>
              <CardHeader><CardTitle>Contact Info</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {contact.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700">{contact.email}</span>
                  </div>
                )}
                {contact.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700">{formatPhone(contact.phone)}</span>
                  </div>
                )}
                {contact.source && (
                  <div className="flex items-center gap-2 text-sm">
                    <Tag className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700">Source: {formatLeadSource(contact.source)}</span>
                  </div>
                )}
                {contact.date_of_birth && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700">DOB: {formatDate(contact.date_of_birth)}</span>
                  </div>
                )}

                {/* Stage */}
                {contact.stage && (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-1.5">Pipeline Stage</p>
                    <span
                      className="rounded-full px-3 py-1 text-xs font-medium"
                      style={{ backgroundColor: `${contact.stage.color}20`, color: contact.stage.color }}
                    >
                      {contact.stage.name}
                    </span>
                  </div>
                )}

                {/* Status */}
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1.5">Status</p>
                  <Badge variant={contact.status === 'patient' ? 'success' : contact.status === 'inactive' ? 'secondary' : 'default'}>
                    {contact.status.charAt(0).toUpperCase() + contact.status.slice(1)}
                  </Badge>
                </div>

                {/* Procedures */}
                {(contact.procedure_interest ?? []).length > 0 && (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-1.5">Procedure Interest</p>
                    <div className="flex flex-wrap gap-1">
                      {contact.procedure_interest!.map((p: string) => (
                        <Badge key={p} variant="secondary">{formatProcedure(p)}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags */}
                {tags.length > 0 && (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-1.5">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag: any) => (
                        <Badge key={tag.id} variant="outline" style={{ borderColor: tag.color, color: tag.color }}>
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            {contact.notes && (
              <Card>
                <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 whitespace-pre-line">{contact.notes}</p>
                </CardContent>
              </Card>
            )}

            {/* Meta */}
            <Card>
              <CardContent className="pt-4 space-y-1">
                <p className="text-xs text-gray-400">Created: {formatDateTime(contact.created_at)}</p>
                {contact.last_contacted_at && (
                  <p className="text-xs text-gray-400">Last contacted: {formatRelative(contact.last_contacted_at)}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right column: timeline */}
          <div className="space-y-4 lg:col-span-2">
            {/* Consultations */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Consultations ({consultations.length})</CardTitle>
                <BookConsultationDialog contactId={contact.id} />
              </CardHeader>
              <CardContent>
                {consultations.length === 0 ? (
                  <p className="text-sm text-gray-400">No consultations scheduled yet.</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {consultations.map((c: any) => (
                      <div key={c.id} className="py-3 flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{formatDateTime(c.scheduled_at)}</p>
                          <p className="text-xs text-gray-400">{c.type} · {c.duration_min} min · {c.assignee?.full_name ?? 'Unassigned'}</p>
                          {c.pre_consult_notes && <p className="text-xs text-gray-500 mt-0.5 italic">"{c.pre_consult_notes}"</p>}
                        </div>
                        <Badge variant={c.status === 'completed' ? 'success' : c.status === 'no_show' ? 'destructive' : 'default'}>
                          {c.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Conversation */}
            <Card>
              <CardHeader><CardTitle>Conversation ({messages.length})</CardTitle></CardHeader>
              <CardContent>
                {messages.length === 0 ? (
                  <p className="text-sm text-gray-400">No messages yet.</p>
                ) : (
                  <div className="space-y-3">
                    {[...messages].reverse().map((m: any) => {
                      const inbound = m.direction === 'inbound'
                      const failed  = m.status === 'failed'
                      return (
                        <div key={m.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                          <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                            inbound
                              ? 'bg-gray-100 text-gray-800'
                              : 'bg-brand-50 text-gray-800'
                          }`}>
                            <div className={`flex items-center gap-1.5 text-xs font-medium ${
                              inbound ? 'text-gray-500' : 'text-brand-600'
                            }`}>
                              {m.channel === 'sms' ? <MessageSquare className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
                              <span>{m.channel.toUpperCase()}</span>
                              <span className="text-gray-400">·</span>
                              <span className="text-gray-400">{formatRelative(m.created_at)}</span>
                            </div>
                            {m.subject && <p className="font-medium text-gray-700 mt-1">{m.subject}</p>}
                            <p className="mt-1 whitespace-pre-line">{m.body}</p>
                            {failed && (
                              <p className="mt-1 text-xs font-medium text-red-600">Failed to send</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Activity log */}
            <Card>
              <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
              <CardContent>
                {activity.length === 0 ? (
                  <p className="text-sm text-gray-400">No activity yet.</p>
                ) : (
                  <div className="space-y-2">
                    {activity.map((a: any) => (
                      <div key={a.id} className="flex items-start gap-2">
                        <Activity className="h-3.5 w-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">{a.action.replace(/_/g, ' ')}</span>
                            {a.user && ` by ${a.user.full_name}`}
                          </p>
                          <p className="text-xs text-gray-400">{formatRelative(a.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
