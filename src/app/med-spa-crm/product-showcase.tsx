'use client'

import { useState } from 'react'
import {
  LayoutDashboard,
  Users,
  Kanban,
  CalendarCheck,
  Zap,
  Settings,
  UserPlus,
  AlertCircle,
  TrendingUp,
  MoreHorizontal,
} from 'lucide-react'

type Tab = 'dashboard' | 'pipeline' | 'consultations'

// ── Sidebar nav items ─────────────────────────────────────────
const NAV_ITEMS = [
  { label: 'Dashboard',      icon: LayoutDashboard, id: 'dashboard'     },
  { label: 'Leads',          icon: Users,           id: 'leads'         },
  { label: 'Pipeline',       icon: Kanban,          id: 'pipeline'      },
  { label: 'Consultations',  icon: CalendarCheck,   id: 'consultations' },
  { label: 'Automations',    icon: Zap,             id: 'automations'   },
  { label: 'Settings',       icon: Settings,        id: 'settings'      },
]

// ── Shared mock data ──────────────────────────────────────────
const RECENT_LEADS = [
  { name: 'Sofia Martinez',  contact: 'sofia.m@email.com',  stage: 'New Inquiry',    color: '#6366f1', time: '2h ago'    },
  { name: 'Emma Chen',       contact: 'emma.c@email.com',   stage: 'Follow-Up Sent', color: '#d97706', time: '5h ago'    },
  { name: 'Olivia Patel',    contact: 'olivia.p@email.com', stage: 'Consult Booked', color: '#059669', time: 'Yesterday' },
  { name: 'Isabella Torres', contact: 'isa.t@email.com',    stage: 'New Inquiry',    color: '#6366f1', time: 'Yesterday' },
]

const UPCOMING = [
  { name: 'Sofia Martinez', time: 'Today · 2:00 PM',     type: 'In-Person' },
  { name: 'James Wilson',   time: 'Today · 4:30 PM',     type: 'Virtual'   },
  { name: 'Priya Sharma',   time: 'Tomorrow · 10:00 AM', type: 'In-Person' },
]

const PIPELINE = [
  {
    name: 'New Inquiry', color: '#6366f1',
    leads: [
      { name: 'Sofia Martinez',  procedure: 'Botox'       },
      { name: 'Isabella Torres', procedure: 'Lip Filler'  },
      { name: 'Michael Park',    procedure: 'HydraFacial' },
    ],
  },
  {
    name: 'Follow-Up Sent', color: '#d97706',
    leads: [
      { name: 'Emma Chen',  procedure: 'Dermal Filler' },
      { name: 'Ava Nguyen', procedure: 'HydraFacial'  },
    ],
  },
  {
    name: 'Consult Booked', color: '#059669',
    leads: [
      { name: 'Olivia Patel', procedure: 'Laser Resurfacing' },
      { name: 'James Wilson', procedure: 'Botox'             },
    ],
  },
  {
    name: 'Treatment Scheduled', color: '#7c3aed',
    leads: [
      { name: 'Priya Sharma', procedure: 'Filler Package' },
    ],
  },
]

const CONSULTS = [
  { month: 'APR', day: 18, time: '2:00 PM',  name: 'Sofia Martinez', procedure: 'Botox Consultation', status: 'Confirmed', type: 'In-Person', min: 30 },
  { month: 'APR', day: 18, time: '4:30 PM',  name: 'James Wilson',   procedure: 'Botox Consultation', status: 'Confirmed', type: 'Virtual',   min: 30 },
  { month: 'APR', day: 19, time: '10:00 AM', name: 'Priya Sharma',   procedure: 'Filler Package',     status: 'Scheduled', type: 'In-Person', min: 45 },
  { month: 'APR', day: 25, time: '11:00 AM', name: 'Emma Chen',      procedure: 'Laser Consultation', status: 'Scheduled', type: 'In-Person', min: 45 },
]

// ─────────────────────────────────────────────────────────────
// DESKTOP components (sidebar + tabbed browser frame)
// ─────────────────────────────────────────────────────────────

function MockSidebar({ activeTab }: { activeTab: Tab }) {
  return (
    <aside className="hidden w-44 flex-none flex-col border-r border-gray-200 bg-white sm:flex">
      <div className="flex h-12 items-center gap-2 border-b border-gray-200 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
          <span className="text-xs font-bold text-white">T</span>
        </div>
        <span className="text-sm font-bold text-gray-900">Tarhunna</span>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV_ITEMS.map(({ label, icon: Icon, id }) => {
          const active = id === activeTab
          return (
            <div
              key={id}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                active ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-indigo-600' : 'text-gray-400'}`} />
              {label}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

function DashboardPanel() {
  const stats = [
    { label: 'New Leads Today',     value: 8,     sub: '24 this week',        Icon: UserPlus,     color: 'text-indigo-600',  bg: 'bg-indigo-50'  },
    { label: 'Consultations Today', value: 3,     sub: '11 this week',        Icon: CalendarCheck,color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'No-Shows This Week',  value: 1,     sub: 'Needs recovery',      Icon: AlertCircle,  color: 'text-amber-600',   bg: 'bg-amber-50'   },
    { label: 'Conversion Rate',     value: '71%', sub: 'Lead → Consultation', Icon: TrendingUp,   color: 'text-purple-600',  bg: 'bg-purple-50'  },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center border-b border-gray-200 bg-white px-5 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Good morning, Sarah</p>
          <p className="text-xs text-gray-400">Glow Med Spa</p>
        </div>
      </div>
      <div className="flex-1 overflow-hidden bg-gray-50 p-4 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {stats.map(({ label, value, sub, Icon, color, bg }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xl font-bold text-gray-900">{value}</p>
                  <p className="mt-0.5 text-[10px] font-medium leading-tight text-gray-600">{label}</p>
                  <p className="mt-0.5 text-[10px] text-gray-400">{sub}</p>
                </div>
                <div className={`rounded-lg p-1.5 ${bg}`}>
                  <Icon className={`h-3.5 w-3.5 ${color}`} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
              <span className="text-xs font-semibold text-gray-900">Recent Leads</span>
              <span className="text-[10px] text-indigo-600">View all</span>
            </div>
            <div className="divide-y divide-gray-100 px-4">
              {RECENT_LEADS.map((lead) => (
                <div key={lead.name} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-xs font-medium text-gray-900">{lead.name}</p>
                    <p className="text-[10px] text-gray-400">{lead.contact}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: `${lead.color}20`, color: lead.color }}
                    >
                      {lead.stage}
                    </span>
                    <span className="text-[10px] text-gray-400">{lead.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
              <span className="text-xs font-semibold text-gray-900">Upcoming Consultations</span>
              <span className="text-[10px] text-indigo-600">View all</span>
            </div>
            <div className="divide-y divide-gray-100 px-4">
              {UPCOMING.map((c) => (
                <div key={c.name} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-xs font-medium text-gray-900">{c.name}</p>
                    <p className="text-[10px] text-gray-400">{c.time}</p>
                  </div>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    c.type === 'Virtual' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {c.type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PipelinePanel() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center border-b border-gray-200 bg-white px-5 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Pipeline</p>
          <p className="text-xs text-gray-400">8 active contacts</p>
        </div>
      </div>
      <div className="flex flex-1 gap-3 overflow-x-auto bg-gray-50 p-4">
        {PIPELINE.map((col) => (
          <div key={col.name} className="w-44 flex-none rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2.5">
              <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
              <span className="text-xs font-medium text-gray-700 truncate">{col.name}</span>
              <span className="ml-auto text-[10px] text-gray-400 shrink-0">{col.leads.length}</span>
            </div>
            <div className="space-y-1.5 p-2">
              {col.leads.map((lead) => (
                <div key={lead.name} className="rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm">
                  <p className="text-xs font-medium text-gray-900">{lead.name}</p>
                  <span className="mt-1 inline-block rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                    {lead.procedure}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConsultationsPanel() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center border-b border-gray-200 bg-white px-5 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Consultations</p>
          <p className="text-xs text-gray-400">4 upcoming · 2 today</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 space-y-3">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs w-fit">
          {['Upcoming (4)', 'Today (2)', 'No-Shows (1)', 'Completed (12)'].map((t, i) => (
            <div
              key={t}
              className={`rounded-md px-3 py-1 font-medium ${
                i === 0 ? 'bg-gray-100 text-gray-900' : 'text-gray-400'
              }`}
            >
              {t}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {CONSULTS.map((c) => (
            <div
              key={`${c.name}-${c.day}`}
              className="flex items-start justify-between rounded-xl border border-gray-200 bg-white p-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center rounded-lg bg-indigo-50 px-2.5 py-1.5 text-center min-w-[46px]">
                  <span className="text-[10px] font-medium text-indigo-600">{c.month}</span>
                  <span className="text-lg font-bold leading-none text-indigo-700">{c.day}</span>
                  <span className="text-[10px] text-indigo-500">{c.time}</span>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-900">{c.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      c.status === 'Confirmed'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {c.status}
                    </span>
                    <span className="rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500">
                      {c.type}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">{c.procedure}</p>
                  <p className="mt-0.5 text-[10px] text-gray-400">{c.min} min</p>
                </div>
              </div>
              <div className="rounded p-1">
                <MoreHorizontal className="h-4 w-4 text-gray-300" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MOBILE components (intentionally designed for small screens)
// ─────────────────────────────────────────────────────────────

function MobileStepLabel({ number, label }: { number: string; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600">
        <span className="text-[10px] font-bold text-white">{number}</span>
      </div>
      <span className="text-xs font-semibold uppercase tracking-widest text-slate-300">{label}</span>
      <div className="flex-1 h-px bg-slate-700/60" />
    </div>
  )
}

function MobileLeadsCard() {
  const leads = RECENT_LEADS.slice(0, 3)
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-xl shadow-black/40">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3.5">
        <div>
          <p className="text-sm font-semibold text-gray-900">Leads &amp; Contacts</p>
          <p className="text-xs text-gray-400">24 new this week</p>
        </div>
      </div>
      {/* Stat chips */}
      <div className="grid grid-cols-2 gap-2 p-3">
        <div className="rounded-xl bg-indigo-50 px-4 py-3">
          <p className="text-2xl font-bold text-indigo-600">8</p>
          <p className="mt-0.5 text-xs font-medium text-indigo-700">New Leads Today</p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-4 py-3">
          <p className="text-2xl font-bold text-emerald-600">3</p>
          <p className="mt-0.5 text-xs font-medium text-emerald-700">Consultations Today</p>
        </div>
      </div>
      {/* Lead rows — larger text, more breathing room */}
      <div className="divide-y divide-gray-100 px-4">
        {leads.map((lead) => (
          <div key={lead.name} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{lead.name}</p>
              <p className="text-xs text-gray-400">{lead.time}</p>
            </div>
            <span
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ backgroundColor: `${lead.color}20`, color: lead.color }}
            >
              {lead.stage}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MobilePipelineCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-xl shadow-black/40">
      {/* Card header */}
      <div className="border-b border-gray-100 px-4 py-3.5">
        <p className="text-sm font-semibold text-gray-900">Pipeline</p>
        <p className="text-xs text-gray-400">8 active contacts across 4 stages</p>
      </div>
      {/* Stage rows — each with colored accent bar */}
      <div className="space-y-2 p-3">
        {PIPELINE.map((col) => (
          <div key={col.name} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
            {/* Colored accent bar */}
            <div
              className="w-1 self-stretch rounded-full shrink-0"
              style={{ backgroundColor: col.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">{col.name}</span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: `${col.color}20`, color: col.color }}
                >
                  {col.leads.length}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-gray-400">
                {col.leads.map((l) => l.name.split(' ')[0]).join(', ')}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MobileConsultationsCard() {
  const items = CONSULTS.slice(0, 2)
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-xl shadow-black/40">
      {/* Card header */}
      <div className="border-b border-gray-100 px-4 py-3.5">
        <p className="text-sm font-semibold text-gray-900">Consultations</p>
        <p className="text-xs text-gray-400">2 today · 4 upcoming</p>
      </div>
      {/* Consultation items — larger date block, fewer fields */}
      <div className="space-y-2 p-3">
        {items.map((c) => (
          <div
            key={`${c.name}-${c.day}`}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4"
          >
            {/* Larger date block for mobile readability */}
            <div className="flex flex-col items-center rounded-xl bg-indigo-50 px-3 py-2 text-center shrink-0 min-w-[54px]">
              <span className="text-[10px] font-semibold text-indigo-600">{c.month}</span>
              <span className="text-2xl font-bold leading-none text-indigo-700">{c.day}</span>
              <span className="mt-0.5 text-[10px] text-indigo-500">{c.time}</span>
            </div>
            {/* Details — name + status only */}
            <div>
              <p className="text-sm font-semibold text-gray-900">{c.name}</p>
              <p className="mt-0.5 text-xs text-gray-500">{c.procedure}</p>
              <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                c.status === 'Confirmed'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {c.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MobileShowcase() {
  return (
    <div className="sm:hidden space-y-8">
      <div>
        <MobileStepLabel number="01" label="Leads &amp; Dashboard" />
        <MobileLeadsCard />
      </div>
      <div>
        <MobileStepLabel number="02" label="Pipeline &amp; Follow-Up" />
        <MobilePipelineCard />
      </div>
      <div>
        <MobileStepLabel number="03" label="Consultations &amp; Reminders" />
        <MobileConsultationsCard />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────
export function ProductShowcase() {
  const [tab, setTab] = useState<Tab>('dashboard')

  const TABS: { id: Tab; label: string }[] = [
    { id: 'dashboard',     label: 'Dashboard'     },
    { id: 'pipeline',      label: 'Pipeline'      },
    { id: 'consultations', label: 'Consultations' },
  ]

  return (
    <section className="bg-slate-900 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        {/* Headline — shown on all sizes */}
        <div className="mb-8 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-indigo-400">
            See it in action
          </p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Everything your team needs, in one place
          </h2>
        </div>

        {/* Desktop: tab pills + browser chrome frame */}
        <div className="hidden sm:block">
          <div className="mb-6 flex justify-center gap-2">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-black/40">
            <div className="flex items-center gap-3 bg-gray-200 px-4 py-2.5">
              <div className="flex gap-1.5 shrink-0">
                <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <div className="h-3 w-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex flex-1 items-center rounded-md bg-white/80 px-3 py-0.5">
                <span className="text-xs text-gray-400 select-none">
                  app.tarhunna.net/{tab}
                </span>
              </div>
            </div>
            <div className="flex h-[460px] overflow-hidden">
              <MockSidebar activeTab={tab} />
              {tab === 'dashboard'     && <DashboardPanel />}
              {tab === 'pipeline'      && <PipelinePanel />}
              {tab === 'consultations' && <ConsultationsPanel />}
            </div>
          </div>
        </div>

        {/* Mobile: intentionally designed step cards */}
        <MobileShowcase />

        {/* Caption — shown on all sizes */}
        <p className="mt-8 text-center text-xs text-slate-500">
          Built for the way med spas actually work — not adapted from a generic sales tool
        </p>
      </div>
    </section>
  )
}
