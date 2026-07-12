'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  Check,
  ChevronLeft,
  Clock,
  Loader2,
  AlertCircle,
  CalendarCheck,
} from 'lucide-react'
import { getVerticalConfig } from '@/lib/vertical/config'

/**
 * /book/[slug] — Phase 4 W2 patient-facing booking flow.
 *
 * Three-step state machine:
 *   1. service  — patient picks one of the org's bookable services
 *   2. slot     — patient picks an available time + provider
 *   3. details  — patient enters name + phone (+ optional email)
 *                  + must check the TCPA SMS-consent box. Hold is
 *                  created on entering this step; a 10-min countdown
 *                  ticks down in the header.
 *   4. done     — confirmation screen with summary + honest message
 *                  about reminders.
 *
 * Honest UX:
 *   - The "hold expired" path is not hidden — patient sees the
 *     timer reach 0 and a soft prompt to pick again.
 *   - Race losses (HTTP 409 from the EXCLUDE constraint) show
 *     "That slot was just taken — please pick another."
 *   - "Online booking is paused" surfaces the master toggle being
 *     off, not a generic error.
 */

interface Service {
  id: string
  name: string
  description: string | null
  duration_min: number
  price_cents: number | null
  color: string | null
  provider_ids: string[]
}

interface Provider {
  id: string
  display_name: string
  role_label: string | null
  photo_url: string | null
}

interface PublicLookup {
  org: { id: string; name: string; slug: string; timezone: string }
  services: Service[]
  providers: Provider[]
}

interface Slot {
  startUtc: string
  endUtc: string
  providerIds: string[]
}

type Step = 'service' | 'slot' | 'details' | 'done'

// ── 12-hour formatter for displayed times. Times stored UTC; display
// always in the org's clinic-local timezone so a patient in another
// state sees the clinic's clock, not their own.
function makeTimeFmt(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
function makeDayFmt(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
function makeLongDayFmt(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function priceDollars(cents: number | null): string | null {
  if (cents === null) return null
  return `$${(cents / 100).toFixed(0)}`
}

// ── Vertical + language string table ─────────────────────────
// Every customer-facing string is driven from here so (a) trades/food/
// general tenants stop seeing med-spa nouns ('clinic'/'appointment')
// and (b) a Spanish caller who followed Layla's ?lang=es link reads the
// page in Spanish. The EN + med-spa branch of every entry reproduces the
// exact literal this page showed before, so med-spa output is unchanged.
// The scheduled-thing noun on this surface is 'appointment' for med-spa
// (matching the SMS-consent copy), so terms.engagement is byte-identical
// and used directly.
type Strings = ReturnType<typeof buildStrings>

function buildStrings(lang: 'en' | 'es', vertical: string | null | undefined) {
  const terms = getVerticalConfig(vertical).terms
  const es = lang === 'es'
  const biz = es ? terms.businessEs : terms.business
  const engagement = es ? terms.engagementEs : terms.engagement
  // Spanish article/demonstrative agreement: among the current verticals
  // only med-spa's 'clínica' is feminine; every other business noun is
  // 'negocio' (masculine). Local gender flag — see needs_config_term note.
  const fem = vertical === 'medspa'
  const el = fem ? 'la' : 'el'
  const este = fem ? 'esta' : 'este'
  const Este = fem ? 'Esta' : 'Este'
  return {
    errBookingDisabledTitle: es ? 'Las reservas en línea están pausadas' : 'Online booking is paused',
    errNotFoundTitle: es ? `No pudimos encontrar ${este} ${biz}` : `We couldn't find this ${biz}`,
    errSetupTitle: es ? 'Configuración incompleta' : 'Setup not complete',
    errGenericTitle: es ? 'Algo salió mal' : 'Something went wrong',
    errBookingDisabledBody: es
      ? `${Este} ${biz} no está aceptando reservas en línea en este momento. Comunícate directamente.`
      : `This ${biz} isn't taking online bookings right now. Please reach out to them directly.`,
    errNotFoundBody: es
      ? `Revisa el enlace o comunícate directamente con ${el} ${biz}.`
      : `Double-check the link or contact the ${biz} directly.`,
    errGenericBody: es ? 'Inténtalo de nuevo en un momento.' : 'Please try again in a moment.',
    loading: es ? 'Cargando…' : 'Loading…',

    labelService: es ? 'Elige un servicio' : 'Pick a service',
    labelSlot: es ? 'Elige un horario' : 'Pick a time',
    labelDetails: es ? 'Tus datos' : 'Your details',
    labelDone: es ? 'Reservado' : 'Booked',
    held: es ? 'Apartado' : 'Held',

    chooseBook: es ? '¿Qué te gustaría reservar?' : "Choose what you'd like to book.",
    noServicesTitle: es ? 'Aún no hay servicios disponibles' : 'No services available yet',
    noServicesBody: es
      ? `${Este} ${biz} aún no ha configurado las reservas en línea. Comunícate directamente para agendar.`
      : `This ${biz} hasn't set up online booking yet. Please contact them directly to schedule.`,

    changeService: es ? 'Cambiar servicio' : 'Change service',
    loadingTimes: es ? 'Cargando horarios…' : 'Loading times…',
    couldntLoadTimes: es ? 'No se pudieron cargar los horarios' : "Couldn't load times",
    noAvailability: es ? 'No hay disponibilidad en este momento.' : 'No availability right now.',
    lookupFailed: es ? 'La búsqueda falló' : 'Lookup failed',

    reachYouError: es
      ? `Deja un teléfono o correo para que ${el} ${biz} pueda contactarte.`
      : `Leave a phone number or email so the ${biz} can reach you.`,
    enterNameError: es ? 'Por favor ingresa tu nombre.' : 'Please enter your name.',
    onListTitle: es ? 'Estás en la lista' : "You're on the list",
    onListBody: (orgName: string) => es
      ? `${orgName} tiene tus datos y te contactará en cuanto se abra un horario.`
      : `${orgName} has your details and will reach out as soon as a time opens up.`,
    noTimesTitle: es ? 'No hay horarios disponibles ahora' : 'No times are open right now',
    noTimesBody: (orgName: string) => es
      ? `Deja tus datos y ${orgName} te contactará en cuanto se abra algo.`
      : `Leave your details and ${orgName} will reach out as soon as something opens up.`,
    phName: es ? 'Tu nombre' : 'Your name',
    phPhone: es ? 'Teléfono' : 'Phone',
    phEmailWaitlist: es ? 'Correo (opcional si dejaste teléfono)' : 'Email (optional if you left a phone)',
    waitlistConsentPre: es ? 'Acepto recibir mensajes de ' : 'OK to text me from ',
    waitlistConsentPost: es
      ? ' sobre disponibilidad. Responde STOP para cancelar. Pueden aplicar tarifas de mensajes y datos.'
      : ' about openings. Reply STOP to opt out. Message and data rates may apply.',
    notifyBtn: es ? 'Avísame cuando haya horario' : 'Notify me when a time opens',
    sending: es ? 'Enviando…' : 'Sending…',
    somethingWrong: es ? 'Algo salió mal. Inténtalo de nuevo.' : 'Something went wrong — please try again.',

    changeTime: es ? 'Cambiar horario' : 'Change time',
    withLabel: es ? 'con' : 'with',
    allTimesIn: (tz: string) => (es ? `Todos los horarios en ${tz}` : `All times in ${tz}`),
    labelYourName: es ? 'Tu nombre' : 'Your name',
    labelPhone: es ? 'Teléfono' : 'Phone',
    labelEmailOpt: es ? 'Correo (opcional)' : 'Email (optional)',
    labelNotes: es ? '¿Algo que debamos saber? (opcional)' : 'Anything we should know? (optional)',
    smsConsentPre: es ? 'Acepto recibir mensajes SMS de ' : 'I agree to receive SMS messages from ',
    smsConsentPost: es
      ? ` sobre mi ${engagement} (confirmación + recordatorios). Responde STOP para cancelar. Pueden aplicar tarifas de mensajes y datos.`
      : ` about my ${engagement} (confirmation + reminders). Reply STOP to opt out. Message and data rates may apply.`,
    booking: es ? 'Reservando…' : 'Booking…',
    confirmBooking: es ? 'Confirmar reserva' : 'Confirm booking',

    errNamePhone: es ? 'Por favor ingresa tu nombre y teléfono.' : 'Please enter your name and phone number.',
    errConsent: es
      ? 'Marca la casilla de consentimiento SMS para recibir tu confirmación.'
      : 'Please check the SMS consent box to receive your confirmation.',
    errSlotTaken: es ? 'Ese horario acaba de ocuparse. Por favor elige otro.' : 'That slot was just taken — please pick another time.',
    errTooMany: es ? 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.' : 'Too many requests. Please wait a moment and try again.',
    errCouldNotHold: es ? 'No se pudo apartar este horario. Inténtalo de nuevo.' : 'Could not hold this slot. Please try again.',
    errHoldExpired: es ? 'Tu reserva temporal expiró. Por favor elige un horario de nuevo.' : 'Your hold expired. Please pick a slot again.',
    errCouldNotConfirm: es ? 'No se pudo confirmar tu reserva. Inténtalo de nuevo.' : 'Could not confirm your booking. Please try again.',
    errNetwork: es ? 'Error de red. Inténtalo de nuevo.' : 'Network error. Please try again.',
    errHoldExpiredCountdown: es
      ? 'Tu reserva temporal expiró. Por favor elige un horario de nuevo — no queremos perder tu lugar.'
      : "Your hold expired. Please pick a slot again — we don't want to lose your spot.",

    doneTitle: es ? 'Tu reserva está confirmada' : "You're booked",
    doneBody: es
      ? 'Recibirás una confirmación y un recordatorio por mensaje de texto si tu teléfono está inscrito para mensajes.'
      : "You'll get a confirmation and a reminder by text if your phone is opted in for messages.",
    atLabel: es ? 'en' : 'at',
    doneChange: (orgName: string) => es
      ? `¿Necesitas cambiar tu horario? Contacta a ${orgName} y lo moverán.`
      : `Need to change your time? Contact ${orgName} and they'll move it.`,
  }
}

export function BookingView({
  slug,
  vertical = null,
  lang = 'en',
}: {
  slug: string
  vertical?: string | null
  lang?: 'en' | 'es'
}) {
  const t = useMemo(() => buildStrings(lang, vertical), [lang, vertical])
  // ── Top-level lookup state ──
  const [lookup, setLookup] = useState<PublicLookup | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupErrorMessage, setLookupErrorMessage] = useState<string | null>(null)

  // ── Step state ──
  const [step, setStep] = useState<Step>('service')
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)

  // ── Slot fetching state ──
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)

  // ── Hold + confirm state ──
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [holding, setHolding] = useState(false)
  const [holdInfo, setHoldInfo] = useState<{
    consultationId: string
    holdToken: string
    expiresAt: string
  } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState<{ scheduledAt: string; durationMin: number } | null>(null)

  // ── Hold countdown ──
  const [secondsLeft, setSecondsLeft] = useState(0)
  useEffect(() => {
    if (!holdInfo) return
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(holdInfo.expiresAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left === 0) {
        // Soft expiry — clear hold state, ask patient to pick again.
        setHoldInfo(null)
        setStep('slot')
        setFormError(t.errHoldExpiredCountdown)
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [holdInfo, t])

  // ── Initial org lookup ──
  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const res = await fetch(`/api/booking/public/${encodeURIComponent(slug)}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const code = typeof body.error === 'string' ? body.error : `http_${res.status}`
          const msg  = typeof body.message === 'string' ? body.message : null
          if (!cancelled) { setLookupError(code); setLookupErrorMessage(msg) }
          return
        }
        const json = (await res.json()) as PublicLookup
        if (!cancelled) setLookup(json)
      } catch (err) {
        if (!cancelled) setLookupError(err instanceof Error ? err.message : 'lookup_failed')
      }
    }
    run()
    return () => { cancelled = true }
  }, [slug])

  // ── Slot fetching (when in 'slot' step + a service is chosen) ──
  const loadSlots = useCallback(async (svcId: string) => {
    setSlotsLoading(true)
    setSlotsError(null)
    try {
      const from = new Date()
      const to   = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000)
      const qs = new URLSearchParams({
        serviceId: svcId,
        from: from.toISOString(),
        to:   to.toISOString(),
      })
      const res = await fetch(`/api/booking/public/${encodeURIComponent(slug)}/availability?${qs}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSlotsError(typeof body.message === 'string' ? body.message : t.noAvailability)
        setSlots([])
        return
      }
      const json = (await res.json()) as { slots: Slot[] }
      setSlots(json.slots ?? [])
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : t.lookupFailed)
    } finally {
      setSlotsLoading(false)
    }
  }, [slug, t])

  useEffect(() => {
    if (step === 'slot' && serviceId) {
      void loadSlots(serviceId)
    }
  }, [step, serviceId, loadSlots])

  // ── Derived ──
  const service  = lookup?.services.find(s => s.id === serviceId) ?? null
  const tz       = lookup?.org.timezone ?? 'UTC'
  const timeFmt  = useMemo(() => makeTimeFmt(tz),     [tz])
  const dayFmt   = useMemo(() => makeDayFmt(tz),      [tz])
  const longFmt  = useMemo(() => makeLongDayFmt(tz),  [tz])

  // Group slots by clinic-local day for display.
  const slotsByDay = useMemo(() => {
    const groups = new Map<string, Slot[]>()
    for (const s of slots) {
      const dayKey = dayFmt.format(new Date(s.startUtc))
      const list = groups.get(dayKey) ?? []
      list.push(s)
      groups.set(dayKey, list)
    }
    return Array.from(groups.entries()).map(([day, items]) => ({ day, items }))
  }, [slots, dayFmt])

  // ── Step transitions ──
  function pickService(id: string) {
    setServiceId(id)
    setStep('slot')
  }
  function pickSlot(slot: Slot) {
    setSelectedSlot(slot)
    // If the service has multiple providers, default to the first
    // one the engine returned for this exact start time. Patient
    // can still see which provider is assigned on the confirm step.
    setSelectedProviderId(slot.providerIds[0] ?? null)
    setFormError(null)
    setStep('details')
  }
  function backToServices() {
    setStep('service')
    setServiceId(null)
    setSelectedSlot(null)
    setSelectedProviderId(null)
    setHoldInfo(null)
    setFormError(null)
  }
  function backToSlots() {
    setStep('slot')
    setSelectedSlot(null)
    setSelectedProviderId(null)
    setHoldInfo(null)
    setFormError(null)
  }

  // ── Hold + confirm submit ──
  async function submitBooking() {
    if (!serviceId || !selectedSlot || !selectedProviderId || !lookup) return
    setFormError(null)
    if (!name.trim() || !phone.trim()) {
      setFormError(t.errNamePhone)
      return
    }
    if (!smsConsent) {
      setFormError(t.errConsent)
      return
    }

    setHolding(true)
    try {
      const holdRes = await fetch('/api/booking/hold', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgSlug:      lookup.org.slug,
          serviceId,
          providerId:   selectedProviderId,
          slotStartUtc: selectedSlot.startUtc,
          name:         name.trim(),
          phone:        phone.trim(),
          email:        email.trim() || undefined,
          smsConsent:   true,
          notes:        notes.trim() || undefined,
        }),
      })
      const holdBody = await holdRes.json().catch(() => ({}))
      if (!holdRes.ok) {
        if (holdRes.status === 409) {
          setFormError(t.errSlotTaken)
          setStep('slot')
          if (serviceId) void loadSlots(serviceId)
        } else if (holdRes.status === 429) {
          setFormError(holdBody.message ?? t.errTooMany)
        } else {
          setFormError(holdBody.message ?? holdBody.error ?? t.errCouldNotHold)
        }
        return
      }

      const hold = {
        consultationId: holdBody.consultation_id as string,
        holdToken:      holdBody.hold_token as string,
        expiresAt:      holdBody.expires_at as string,
      }
      setHoldInfo(hold)
      setConfirming(true)

      const confirmRes = await fetch('/api/booking/confirm', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultation_id: hold.consultationId,
          hold_token:      hold.holdToken,
        }),
      })
      const confirmBody = await confirmRes.json().catch(() => ({}))
      if (!confirmRes.ok) {
        if (confirmRes.status === 410) {
          setFormError(confirmBody.message ?? t.errHoldExpired)
          setHoldInfo(null)
          setStep('slot')
          if (serviceId) void loadSlots(serviceId)
        } else {
          setFormError(confirmBody.message ?? t.errCouldNotConfirm)
        }
        return
      }

      setConfirmed({
        scheduledAt: confirmBody.scheduled_at as string,
        durationMin: confirmBody.duration_min as number,
      })
      setStep('done')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t.errNetwork)
    } finally {
      setHolding(false)
      setConfirming(false)
    }
  }

  // ── Render ──
  if (lookupError) {
    return (
      <FullPage>
        <ErrorCard
          title={
            lookupError === 'booking_disabled' ? t.errBookingDisabledTitle :
            lookupError === 'not_found' ? t.errNotFoundTitle :
            lookupError === 'org_timezone_missing' ? t.errSetupTitle :
            t.errGenericTitle
          }
          body={
            lookupErrorMessage ??
            (lookupError === 'booking_disabled'
              ? t.errBookingDisabledBody
              : lookupError === 'not_found'
              ? t.errNotFoundBody
              : t.errGenericBody)
          }
        />
      </FullPage>
    )
  }
  if (!lookup) {
    return (
      <FullPage>
        <div className="flex items-center gap-2 text-sm text-[#7E8C90]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t.loading}
        </div>
      </FullPage>
    )
  }

  return (
    <FullPage>
      <Header
        orgName={lookup.org.name}
        step={step}
        secondsLeft={secondsLeft}
        showCountdown={step === 'details' && holdInfo !== null}
        t={t}
      />

      <main className="mx-auto w-full max-w-2xl px-5 py-8">
        {/* key={step} remounts the wrapper on every step change so the
            step-in slide plays; reduced-motion disables it globally. */}
        <div key={step} className="step-in">
        {step === 'service' && (
          <ServiceStep services={lookup.services} onPick={pickService} t={t} />
        )}
        {step === 'slot' && service && (
          <SlotStep
            service={service}
            slotsByDay={slotsByDay}
            timeFmt={timeFmt}
            slotsLoading={slotsLoading}
            slotsError={slotsError}
            onPick={pickSlot}
            onBack={backToServices}
            slug={slug}
            orgName={lookup.org.name}
            t={t}
          />
        )}
        {step === 'details' && service && selectedSlot && (
          <DetailsStep
            service={service}
            slot={selectedSlot}
            timeFmt={timeFmt}
            longFmt={longFmt}
            tz={tz}
            providers={lookup.providers}
            providerId={selectedProviderId}
            name={name}      setName={setName}
            phone={phone}    setPhone={setPhone}
            email={email}    setEmail={setEmail}
            smsConsent={smsConsent} setSmsConsent={setSmsConsent}
            notes={notes}    setNotes={setNotes}
            formError={formError}
            submitting={holding || confirming}
            onSubmit={submitBooking}
            onBack={backToSlots}
            orgName={lookup.org.name}
            t={t}
          />
        )}
        {step === 'done' && service && confirmed && (
          <DoneStep
            orgName={lookup.org.name}
            service={service}
            scheduledAt={confirmed.scheduledAt}
            durationMin={confirmed.durationMin}
            providers={lookup.providers}
            providerId={selectedProviderId}
            longFmt={longFmt}
            timeFmt={timeFmt}
            t={t}
          />
        )}
        </div>
      </main>
    </FullPage>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F5EFE1]">
      {children}
    </div>
  )
}

function Header({
  orgName,
  step,
  secondsLeft,
  showCountdown,
  t,
}: {
  orgName: string
  step: Step
  secondsLeft: number
  showCountdown: boolean
  t: Strings
}) {
  const labels: Record<Step, string> = {
    service: t.labelService,
    slot:    t.labelSlot,
    details: t.labelDetails,
    done:    t.labelDone,
  }
  return (
    <header className="border-b border-[#0B2027]/10 bg-[#FAF6EC]">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#04B08C]">
            {orgName}
          </p>
          <p className="mt-0.5 text-[15px] font-semibold text-[#14241D]">
            {labels[step]}
          </p>
        </div>
        {showCountdown && secondsLeft > 0 && (
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors duration-500 ${
            secondsLeft <= 60
              ? 'urgent-pulse bg-[#B5710F]/15 text-[#9A5F0B]'
              : 'bg-[#02C39A]/15 text-[#04B08C]'
          }`}>
            <Clock className="h-3 w-3" />
            {t.held} {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </div>
        )}
      </div>
    </header>
  )
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-[#0B2027]/10 bg-[#FAF6EC] p-6 text-center shadow-sm">
      <AlertCircle className="mx-auto h-6 w-6 text-[#B5710F]" />
      <h2 className="mt-3 text-base font-semibold text-[#14241D]">{title}</h2>
      <p className="mt-1 text-[13px] text-[#4A5A60]">{body}</p>
    </div>
  )
}

/**
 * No-times fallback — the old dead end ("call the clinic") lost the
 * patient entirely. Now they can leave their details; the submission
 * rides the existing /api/capture endpoint (dedup + automations +
 * owner alert + patient ack) tagged origin:'waitlist'.
 */
export function WaitlistForm({ slug, orgName, serviceName, t }: { slug: string; orgName: string; serviceName: string; t: Strings }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) { setError(t.enterNameError); return }
    if (!phone.trim() && !email.trim()) { setError(t.reachYouError); return }
    setSubmitting(true)
    setError(null)
    try {
      const [first, ...restName] = name.trim().split(/\s+/)
      const res = await fetch(`/api/capture/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name:  first,
          last_name:   restName.join(' ') || undefined,
          phone:       phone.trim() || undefined,
          email:       email.trim() || undefined,
          sms_consent: smsConsent,
          origin:      'waitlist',
          notes:       `Waitlist: wanted ${serviceName} but no online times were open.`,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? t.somethingWrong)
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.somethingWrong)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="pop-in rounded-2xl border border-[#02C39A]/30 bg-[#FAF6EC] p-6 text-center">
        <CalendarCheck className="mx-auto h-6 w-6 text-[#02C39A]" />
        <h3 className="mt-3 text-base font-semibold text-[#14241D]">{t.onListTitle}</h3>
        <p className="mt-1 text-[13px] text-[#4A5A60]">
          {t.onListBody(orgName)}
        </p>
      </div>
    )
  }

  const inputCls = 'w-full rounded-lg border border-[#0B2027]/15 bg-white px-3 py-2 text-[14px] text-[#14241D] focus:border-[#02C39A] focus:outline-none focus:ring-1 focus:ring-[#02C39A]'

  return (
    <div className="rounded-2xl border border-[#0B2027]/10 bg-[#FAF6EC] p-5">
      <h3 className="text-[15px] font-semibold text-[#14241D]">{t.noTimesTitle}</h3>
      <p className="mt-1 text-[13px] text-[#4A5A60]">
        {t.noTimesBody(orgName)}
      </p>
      <div className="mt-4 space-y-3">
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder={t.phName} aria-label={t.phName} autoComplete="name" className={inputCls} />
        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
          placeholder={t.phPhone} aria-label={t.phPhone} autoComplete="tel" className={inputCls} />
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder={t.phEmailWaitlist} aria-label={t.phEmailWaitlist}
          autoComplete="email" className={inputCls} />
        {phone.trim() !== '' && (
          <label className="flex items-start gap-2 rounded-lg border border-[#0B2027]/10 bg-white p-3 text-[12px] text-[#4A5A60]">
            <input type="checkbox" checked={smsConsent} onChange={e => setSmsConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#0B2027]/30 text-[#02C39A] focus:ring-[#02C39A]" />
            <span>
              {t.waitlistConsentPre}<strong>{orgName}</strong>{t.waitlistConsentPost}
            </span>
          </label>
        )}
        {error && <p role="alert" aria-live="polite" className="text-[12.5px] text-red-600">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="w-full rounded-lg bg-[#028090] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#026B78] disabled:opacity-60 transition-colors"
        >
          {submitting ? t.sending : t.notifyBtn}
        </button>
      </div>
    </div>
  )
}

function ServiceStep({
  services,
  onPick,
  t,
}: {
  services: Service[]
  onPick: (id: string) => void
  t: Strings
}) {
  if (services.length === 0) {
    return (
      <ErrorCard
        title={t.noServicesTitle}
        body={t.noServicesBody}
      />
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#4A5A60]">
        {t.chooseBook}
      </p>
      <ul className="space-y-2">
        {services.map(s => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s.id)}
              className="flex w-full items-start gap-3 rounded-xl border border-[#0B2027]/10 bg-[#FAF6EC] p-4 text-left transition-colors hover:border-[#02C39A]/60 hover:bg-white"
            >
              <span
                className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: s.color ?? '#02C39A' }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[#14241D]">
                  {s.name}
                </p>
                {s.description && (
                  <p className="mt-0.5 text-[12.5px] text-[#4A5A60]">
                    {s.description}
                  </p>
                )}
                <p className="mt-1 text-[11.5px] text-[#7E8C90]">
                  {s.duration_min} min{priceDollars(s.price_cents) ? ` · ${priceDollars(s.price_cents)}` : ''}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SlotStep({
  service,
  slotsByDay,
  timeFmt,
  slotsLoading,
  slotsError,
  onPick,
  onBack,
  slug,
  orgName,
  t,
}: {
  service: Service
  slotsByDay: Array<{ day: string; items: Slot[] }>
  timeFmt: Intl.DateTimeFormat
  slotsLoading: boolean
  slotsError: string | null
  onPick: (s: Slot) => void
  onBack: () => void
  slug: string
  orgName: string
  t: Strings
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-[#7E8C90] hover:text-[#14241D]"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {t.changeService}
      </button>

      <div className="rounded-xl border border-[#0B2027]/10 bg-[#FAF6EC] p-3 text-[13px] text-[#14241D]">
        <p className="font-semibold">{service.name}</p>
        <p className="text-[12px] text-[#4A5A60]">{service.duration_min} min</p>
      </div>

      {slotsLoading && (
        <div className="flex items-center gap-2 text-sm text-[#7E8C90]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t.loadingTimes}
        </div>
      )}
      {slotsError && !slotsLoading && (
        <ErrorCard title={t.couldntLoadTimes} body={slotsError} />
      )}
      {!slotsLoading && !slotsError && slotsByDay.length === 0 && (
        <WaitlistForm slug={slug} orgName={orgName} serviceName={service.name} t={t} />
      )}

      <div className="space-y-4">
        {slotsByDay.map(({ day, items }) => (
          <div key={day}>
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[#4A5A60]">
              {day}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {items.map(s => (
                <button
                  key={s.startUtc}
                  type="button"
                  onClick={() => onPick(s)}
                  className="rounded-lg border border-[#02C39A]/30 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#04B08C] transition-[background-color,transform,border-color] duration-150 hover:bg-[#02C39A]/10 hover:border-[#02C39A]/60 active:scale-95"
                >
                  {timeFmt.format(new Date(s.startUtc))}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DetailsStep({
  service,
  slot,
  timeFmt,
  longFmt,
  tz,
  providers,
  providerId,
  name, setName,
  phone, setPhone,
  email, setEmail,
  smsConsent, setSmsConsent,
  notes, setNotes,
  formError,
  submitting,
  onSubmit,
  onBack,
  orgName,
  t,
}: {
  service: Service
  slot: Slot
  timeFmt: Intl.DateTimeFormat
  longFmt: Intl.DateTimeFormat
  tz: string
  providers: Provider[]
  providerId: string | null
  name: string;       setName: (v: string) => void
  phone: string;      setPhone: (v: string) => void
  email: string;      setEmail: (v: string) => void
  smsConsent: boolean; setSmsConsent: (v: boolean) => void
  notes: string;      setNotes: (v: string) => void
  formError: string | null
  submitting: boolean
  onSubmit: () => void
  onBack: () => void
  orgName: string
  t: Strings
}) {
  const provider = providers.find(p => p.id === providerId) ?? null
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-[#7E8C90] hover:text-[#14241D]"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {t.changeTime}
      </button>

      <div className="rounded-xl border border-[#02C39A]/30 bg-white p-4 text-[13px] text-[#14241D]">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[#04B08C]">
          {service.name}
        </p>
        <p className="mt-1 text-[15px] font-semibold">
          {longFmt.format(new Date(slot.startUtc))}
        </p>
        <p className="mt-0.5 text-[13px] text-[#4A5A60]">
          {timeFmt.format(new Date(slot.startUtc))} · {service.duration_min} min
        </p>
        {provider && (
          <p className="mt-1 text-[12px] text-[#7E8C90]">
            {t.withLabel} {provider.display_name}
            {provider.role_label ? `, ${provider.role_label}` : ''}
          </p>
        )}
        <p className="mt-1 text-[11px] text-[#7E8C90]">{t.allTimesIn(tz)}</p>
      </div>

      <div className="space-y-3">
        <FormRow label={t.labelYourName}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="name"
            className="w-full rounded-lg border border-[#0B2027]/15 bg-white px-3 py-2 text-[14px] text-[#14241D] focus:border-[#02C39A] focus:outline-none focus:ring-1 focus:ring-[#02C39A]"
          />
        </FormRow>
        <FormRow label={t.labelPhone}>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="(555) 123-4567"
            className="w-full rounded-lg border border-[#0B2027]/15 bg-white px-3 py-2 text-[14px] text-[#14241D] focus:border-[#02C39A] focus:outline-none focus:ring-1 focus:ring-[#02C39A]"
          />
        </FormRow>
        <FormRow label={t.labelEmailOpt}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            className="w-full rounded-lg border border-[#0B2027]/15 bg-white px-3 py-2 text-[14px] text-[#14241D] focus:border-[#02C39A] focus:outline-none focus:ring-1 focus:ring-[#02C39A]"
          />
        </FormRow>
        <FormRow label={t.labelNotes}>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[#0B2027]/15 bg-white px-3 py-2 text-[13.5px] text-[#14241D] focus:border-[#02C39A] focus:outline-none focus:ring-1 focus:ring-[#02C39A]"
          />
        </FormRow>

        <label className="flex items-start gap-2 rounded-lg border border-[#0B2027]/10 bg-[#FAF6EC] p-3 text-[12px] text-[#4A5A60]">
          <input
            type="checkbox"
            checked={smsConsent}
            onChange={e => setSmsConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[#0B2027]/30 text-[#02C39A] focus:ring-[#02C39A]"
          />
          <span>
            {t.smsConsentPre}<strong>{orgName}</strong>{t.smsConsentPost}
          </span>
        </label>
      </div>

      {formError && (
        <div className="flex items-start gap-2 rounded-lg border border-[#B5710F]/30 bg-[#B5710F]/10 p-3 text-[12.5px] text-[#B5710F]">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#02C39A] px-4 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#04B08C] disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.booking}
          </>
        ) : (
          <>
            <CalendarCheck className="h-4 w-4" />
            {t.confirmBooking}
          </>
        )}
      </button>
    </div>
  )
}

function DoneStep({
  orgName,
  service,
  scheduledAt,
  durationMin,
  providers,
  providerId,
  longFmt,
  timeFmt,
  t,
}: {
  orgName: string
  service: Service
  scheduledAt: string
  durationMin: number
  providers: Provider[]
  providerId: string | null
  longFmt: Intl.DateTimeFormat
  timeFmt: Intl.DateTimeFormat
  t: Strings
}) {
  const provider = providers.find(p => p.id === providerId) ?? null
  return (
    <div className="mt-4 space-y-5 text-center">
      <div className="pop-in mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#02C39A]/15">
        <Check className="pop-in h-6 w-6 text-[#04B08C]" style={{ animationDelay: '120ms' }} />
      </div>
      <div>
        <h2 className="text-[18px] font-semibold text-[#14241D]">{t.doneTitle}</h2>
        <p className="mt-1 text-[13px] text-[#4A5A60]">
          {t.doneBody}
        </p>
      </div>
      <div className="mx-auto max-w-md rounded-xl border border-[#02C39A]/30 bg-white p-4 text-left text-[13px] text-[#14241D]">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[#04B08C]">
          {service.name} {t.atLabel} {orgName}
        </p>
        <p className="mt-1 text-[15px] font-semibold">
          {longFmt.format(new Date(scheduledAt))}
        </p>
        <p className="mt-0.5 text-[#4A5A60]">
          <Calendar className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
          {timeFmt.format(new Date(scheduledAt))} · {durationMin} min
        </p>
        {provider && (
          <p className="mt-1 text-[12px] text-[#7E8C90]">
            {t.withLabel} {provider.display_name}
            {provider.role_label ? `, ${provider.role_label}` : ''}
          </p>
        )}
      </div>
      <p className="text-[11.5px] text-[#7E8C90]">
        {t.doneChange(orgName)}
      </p>
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-wider text-[#4A5A60]">
        {label}
      </span>
      {children}
    </label>
  )
}
