/**
 * Day-0 welcome email — sent right after self-serve signup succeeds.
 *
 * Before this existed the first email an owner EVER received was the
 * 7-day trial reminder: an owner who signed up and closed the tab got
 * zero contact for a week. This is the cheapest re-engagement channel
 * we have, so it fires on every signup, and its three steps mirror the
 * dashboard SetupGuide's foundation group (services → hours → booking
 * page) so the email and the in-app checklist tell one story.
 *
 * Failure policy: NEVER fail the signup on email problems — callers
 * fire-and-forget with a .catch that logs. Idempotency key is
 * welcome:<orgId> so an accidental double-call inside Resend's 24h
 * dedup window collapses to one send.
 */

import { sendEmail, escapeHtml } from '@/lib/resend'
import { APP_URL, wrap, p, btn } from '@/lib/email/branded'
import { getVerticalConfig } from '@/lib/vertical/config'

export async function sendWelcomeEmail(args: {
  orgId: string
  orgName: string
  ownerEmail: string
  ownerFullName: string
  trialEndsAt: string   // ISO
  /** Tenant vertical — drives the business/engagement/service nouns.
   *  Defaults to med-spa so an unset value is byte-identical to before. */
  vertical?: string | null
  /** Owner's reading language. Defaults to English. */
  ownerLanguage?: 'en' | 'es'
}): Promise<void> {
  // Signup requires no email verification, so clinic_name/full_name
  // are attacker-controllable for an arbitrary recipient address —
  // escape everything user-typed before it touches HTML.
  const rawFirstName = (args.ownerFullName ?? '').split(' ')[0] || 'there'
  const firstName = escapeHtml(rawFirstName)   // HTML body only
  const orgName = escapeHtml(args.orgName)

  // Multi-vertical: the org noun, the scheduled-thing noun, and the
  // bookable-item noun all come from the vertical config. Med-spa keeps
  // 'clinic' / 'appointments' / 'treatments' — byte-identical.
  const cfg = getVerticalConfig(args.vertical)
  const terms = cfg.terms
  const isMedspa = cfg.vertical === 'medspa'
  const lang: 'en' | 'es' = args.ownerLanguage === 'es' ? 'es' : 'en'
  const servicesWord = isMedspa ? 'treatments' : 'services'

  const endsPretty = new Date(args.trialEndsAt).toLocaleDateString(
    lang === 'es' ? 'es' : 'en-US',
    { month: 'long', day: 'numeric' },
  )

  let html: string
  let subject: string
  if (lang === 'es') {
    const servicesWordEs = isMedspa ? 'tratamientos' : 'servicios'
    html = wrap(`
    ${p(`Hola ${firstName},`)}
    ${p(`¡Bienvenido a Tarhunna! Tu prueba gratis de 14 días para <strong>${orgName}</strong> ya está activa — tienes todo desbloqueado hasta el <strong>${endsPretty}</strong>, incluyendo a Layla, la recepcionista con IA que contesta el teléfono de tu ${terms.businessEs} y agenda ${terms.engagementPluralEs} en la llamada.`)}
    ${p(`La forma más rápida de ver el valor: pon en marcha tu motor de reservas. Tres pasos, unos diez minutos:`)}
    <ol style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.9;">
      <li><strong>Agrega tus servicios</strong> — los ${servicesWordEs} que los clientes pueden reservar, con precios</li>
      <li><strong>Configura tu horario</strong> — para que solo se reserve disponibilidad real</li>
      <li><strong>Publica tu página de reservas</strong> — los clientes reservan solos, 24/7</li>
    </ol>
    ${p(`Tu panel te guía en cada paso y luego para poner a Layla al teléfono.`)}
    <p style="margin:24px 0 0 0;">${btn('Abre tu panel', `${APP_URL}/dashboard`)}</p>
    ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">¿Preguntas? Solo responde a este correo.</span>`)}
  `)
    subject = `Bienvenido a Tarhunna — tu prueba gratis está activa, ${rawFirstName}`
  } else {
    html = wrap(`
    ${p(`Hi ${firstName},`)}
    ${p(`Welcome to Tarhunna! Your 14-day free trial for <strong>${orgName}</strong> is live — you have everything unlocked through <strong>${endsPretty}</strong>, including Layla, the AI receptionist who answers your ${terms.business}'s phone and books ${terms.engagementPlural} on the call.`)}
    ${p(`The fastest way to see the value: get your booking engine live. Three steps, about ten minutes:`)}
    <ol style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.9;">
      <li><strong>Add your services</strong> — the ${servicesWord} clients can book, with prices</li>
      <li><strong>Set your hours</strong> — so only real availability gets booked</li>
      <li><strong>Publish your booking page</strong> — clients book themselves, 24/7</li>
    </ol>
    ${p(`Your dashboard walks you through each step, then through putting Layla on the phone.`)}
    <p style="margin:24px 0 0 0;">${btn('Open your dashboard', `${APP_URL}/dashboard`)}</p>
    ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">Questions? Just reply to this email.</span>`)}
  `)
    subject = `Welcome to Tarhunna — your free trial is live, ${rawFirstName}`
  }

  await sendEmail({
    to: args.ownerEmail,
    subject,
    html,
    idempotencyKey: `welcome:${args.orgId}`,
  })
}
