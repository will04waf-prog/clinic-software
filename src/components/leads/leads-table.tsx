'use client'
import Link from 'next/link'
import { MoreHorizontal, Mail, Phone, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatRelative, formatPhone, formatProcedure } from '@/lib/utils'
import type { Contact, PipelineStage } from '@/types'

interface LeadsTableProps {
  contacts: Contact[]
  onRefresh: () => void
  search: string
  onSearchChange: (v: string) => void
  totalForTab: number
}

const STATUS_COLORS: Record<string, string> = {
  lead:     'default',
  patient:  'success',
  inactive: 'secondary',
}

function StageChip({ stage }: { stage?: PipelineStage }) {
  if (!stage) return <span className="text-xs text-gray-400">—</span>
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
    >
      {stage.name}
    </span>
  )
}

export function LeadsTable({ contacts, onRefresh, search, onSearchChange, totalForTab }: LeadsTableProps) {
  // contacts is already tab-filtered and search-filtered by the parent page
  const filtered = contacts

  async function archiveContact(id: string) {
    await fetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_archived: true }),
    })
    onRefresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          className="pl-9"
          placeholder="Search by name, email, or phone..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Stage</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Procedures</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Activity</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                  No contacts found.
                </td>
              </tr>
            )}
            {filtered.map((contact) => (
              <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/leads/${contact.id}`} className="block">
                    <p className="font-medium text-gray-900 hover:text-indigo-600">
                      {contact.first_name} {contact.last_name}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {contact.email && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Mail className="h-3 w-3" />{contact.email}
                        </span>
                      )}
                      {contact.phone && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Phone className="h-3 w-3" />{formatPhone(contact.phone)}
                        </span>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StageChip stage={contact.stage} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(contact.procedure_interest ?? []).slice(0, 2).map((p) => (
                      <Badge key={p} variant="secondary" className="text-xs">{formatProcedure(p)}</Badge>
                    ))}
                    {(contact.procedure_interest ?? []).length > 2 && (
                      <Badge variant="secondary">+{(contact.procedure_interest ?? []).length - 2}</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {contact.last_activity_at ? formatRelative(contact.last_activity_at) : '—'}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_COLORS[contact.status] as any}>
                    {contact.status.charAt(0).toUpperCase() + contact.status.slice(1)}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/leads/${contact.id}`}>View Profile</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => archiveContact(contact.id)} className="text-red-600">
                        Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">{filtered.length} of {totalForTab} contacts</p>
    </div>
  )
}
