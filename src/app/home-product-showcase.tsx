// Static server component — no 'use client' needed, no JS

// ── Mock data ─────────────────────────────────────────────────

const LEADS = [
  { name: 'Sofia Martinez',  email: 'sofia.m@email.com',   stage: 'New Inquiry',       color: '#6366f1', time: '2h ago'    },
  { name: 'Emma Chen',       email: 'emma.c@email.com',    stage: 'Follow-Up Sent',    color: '#d97706', time: '5h ago'    },
  { name: 'Olivia Patel',    email: 'olivia.p@email.com',  stage: 'Consultation Booked', color: '#059669', time: 'Yesterday' },
  { name: 'James Wilson',    email: 'j.wilson@email.com',  stage: 'New Inquiry',       color: '#6366f1', time: 'Yesterday' },
  { name: 'Priya Sharma',    email: 'priya.s@email.com',   stage: 'Follow-Up Sent',    color: '#d97706', time: '2d ago'    },
]

const PIPELINE = [
  {
    name: 'New Inquiry', color: '#6366f1',
    leads: [
      { name: 'Sofia Martinez', procedure: 'Botox'      },
      { name: 'James Wilson',   procedure: 'Filler'     },
    ],
  },
  {
    name: 'Follow-Up Sent', color: '#d97706',
    leads: [
      { name: 'Emma Chen',   procedure: 'Laser'      },
      { name: 'Priya Sharma', procedure: 'HydraFacial' },
    ],
  },
  {
    name: 'Consultation Booked', color: '#059669',
    leads: [
      { name: 'Olivia Patel', procedure: 'Filler Package' },
      { name: 'Ava Nguyen',   procedure: 'Botox'          },
    ],
  },
]

const CONSULTS = [
  { month: 'APR', day: 18, time: '2:00 PM',  name: 'Sofia Martinez', procedure: 'Botox Consultation',   status: 'Confirmed', reminder: true  },
  { month: 'APR', day: 18, time: '4:30 PM',  name: 'James Wilson',   procedure: 'Filler Consultation',  status: 'Confirmed', reminder: false },
  { month: 'APR', day: 19, time: '10:00 AM', name: 'Priya Sharma',   procedure: 'Laser Consultation',   status: 'Scheduled', reminder: false },
]

// ── Chrome bar shared by all panels ──────────────────────────

function ChromeBar({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-3 bg-gray-200 px-4 py-2.5 shrink-0">
      <div className="flex gap-1.5 shrink-0">
        <div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <div className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
      </div>
      <div className="flex-1 rounded-md bg-white/80 px-3 py-0.5">
        <span className="text-xs text-gray-400 select-none">app.tarhunna.net/{url}</span>
      </div>
    </div>
  )
}

// ── Panel 01: Leads ───────────────────────────────────────────

function LeadsPanel() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 shadow-xl shadow-black/30">
      <ChromeBar url="leads" />
      <div className="flex flex-col overflow-hidden bg-gray-50">
        {/* Page header */}
        <div className="border-b border-gray-200 bg-white px-5 py-3">
          <p className="text-sm font-semibold text-gray-900">Leads &amp; Contacts</p>
          <p className="text-xs text-gray-400">26 contacts</p>
        </div>
        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-gray-100 bg-white px-5 py-2">
          <span className="text-xs font-medium text-gray-400">Contact</span>
          <span className="text-xs font-medium text-gray-400">Stage</span>
          <span className="text-xs font-medium text-gray-400">Added</span>
        </div>
        {/* Rows */}
        <div className="divide-y divide-gray-100 bg-white">
          {LEADS.map((lead) => (
            <div key={lead.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{lead.name}</p>
                <p className="truncate text-xs text-gray-400">{lead.email}</p>
              </div>
              <span
                className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: `${lead.color}20`, color: lead.color }}
              >
                {lead.stage}
              </span>
              <span className="whitespace-nowrap text-xs text-gray-400">{lead.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Panel 02: Pipeline ────────────────────────────────────────

function PipelinePanel() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 shadow-xl shadow-black/30">
      <ChromeBar url="pipeline" />
      <div className="flex flex-col overflow-hidden bg-gray-50">
        {/* Page header */}
        <div className="border-b border-gray-200 bg-white px-5 py-3">
          <p className="text-sm font-semibold text-gray-900">Pipeline</p>
          <p className="text-xs text-gray-400">8 active contacts</p>
        </div>
        {/* Kanban */}
        <div className="flex gap-2 overflow-x-auto p-3">
          {PIPELINE.map((col) => (
            <div key={col.name} className="w-36 flex-none rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-2">
                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                <span className="truncate text-xs font-medium text-gray-700">{col.name}</span>
                <span className="ml-auto text-[10px] text-gray-400 shrink-0">{col.leads.length}</span>
              </div>
              <div className="space-y-1.5 p-1.5">
                {col.leads.map((lead) => (
                  <div key={lead.name} className="rounded-lg border border-gray-100 bg-gray-50 p-2 shadow-sm">
                    <p className="text-xs font-medium text-gray-900 leading-tight">{lead.name}</p>
                    <span className="mt-1 inline-block rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500">
                      {lead.procedure}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Panel 03: Consultations ───────────────────────────────────

function ConsultationsPanel() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 shadow-xl shadow-black/30">
      <ChromeBar url="consultations" />
      <div className="flex flex-col overflow-hidden bg-gray-50">
        {/* Page header */}
        <div className="border-b border-gray-200 bg-white px-5 py-3">
          <p className="text-sm font-semibold text-gray-900">Consultations</p>
          <p className="text-xs text-gray-400">4 upcoming · 2 today</p>
        </div>
        {/* List */}
        <div className="space-y-2 p-3">
          {CONSULTS.map((c) => (
            <div
              key={`${c.name}-${c.day}`}
              className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3"
            >
              {/* Date block — matches real ConsultationList */}
              <div className="flex flex-col items-center rounded-lg bg-indigo-50 px-2.5 py-1.5 text-center shrink-0 min-w-[46px]">
                <span className="text-[10px] font-medium text-indigo-600">{c.month}</span>
                <span className="text-lg font-bold leading-none text-indigo-700">{c.day}</span>
                <span className="text-[10px] text-indigo-500">{c.time}</span>
              </div>
              {/* Details */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-900">{c.name}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    c.status === 'Confirmed'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {c.status}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500">{c.procedure}</p>
                {c.reminder && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                    SMS Reminder Sent
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Step label ────────────────────────────────────────────────

function StepLabel({ number, label }: { number: string; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-xs font-bold text-indigo-400">{number}</span>
      <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</span>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────

export function HomeProductShowcase() {
  return (
    <section className="bg-slate-900 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        {/* Headline */}
        <div className="mb-10 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-indigo-400">
            The platform
          </p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            From first inquiry to booked consultation
          </h2>
        </div>

        {/* Row 1: Full-width Leads panel */}
        <div className="mb-4">
          <StepLabel number="01" label="Capture &amp; Organize" />
          <LeadsPanel />
        </div>

        {/* Row 2: Pipeline + Consultations side-by-side */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <StepLabel number="02" label="Pipeline &amp; Follow-Up" />
            <PipelinePanel />
          </div>
          <div>
            <StepLabel number="03" label="Book &amp; Remind" />
            <ConsultationsPanel />
          </div>
        </div>

        {/* Caption */}
        <p className="mt-6 text-center text-xs text-slate-500">
          One platform for every step — no patchwork of tools required
        </p>
      </div>
    </section>
  )
}
