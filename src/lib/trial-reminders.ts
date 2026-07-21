import { supabaseAdmin } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/types/database'
import { sendEmail } from '@/lib/resend'
import { withCronLock } from '@/lib/cron-locks'
import { getOrgOwner } from '@/lib/org-owner'
import { isLoopVertical } from '@/lib/vertical/config'
// Shared branded building blocks — extracted to email/branded.ts so the
// welcome email + weekly digest render identically to these reminders.
import { APP_URL, wrap as wrapBase, p, btn } from '@/lib/email/branded'

const wrap = (content: string) =>
  wrapBase(content, "Tarhunna &middot; You're receiving this because your account is on a free trial.")
// Spanish footer for the CRM (loop) verticals.
const wrapEs = (content: string) =>
  wrapBase(content, 'Tarhunna &middot; Recibe esto porque su cuenta está en prueba gratis.')

// CRM (landscaping/trades) owners are Spanish-first and priced at $39 —
// they must NEVER see the med-spa "$297"/"leads, pipeline, consultations"
// framing (a wrong-price + wrong-product trust bug). `loop` selects the
// Spanish, loop-framed, $39 content with the honest "no charge without
// warning" line; med-spa (loop=false) renders byte-identically to before.

function email7d(firstName: string, orgName: string, loop: boolean) {
  if (loop) return {
    subject: `¿Cómo va su prueba de Tarhunna, ${firstName}?`,
    html: wrapEs(`
      ${p(`Hola ${firstName},`)}
      ${p(`Lleva una semana con Tarhunna en <strong>${orgName}</strong>. Buen comienzo.`)}
      ${p(`Con su cuenta puede: crear estimados en 2 minutos, mandarlos por WhatsApp, y cobrar con tarjeta, efectivo o Zelle — todo desde el teléfono.`)}
      ${p(`Le quedan 7 días de prueba gratis. Suscríbase cuando quiera para seguir sin interrupciones.`)}
      <p style="margin:24px 0 0 0;">${btn('Ir a mi panel', `${APP_URL}/dashboard`)}</p>
    `),
  }
  return {
    subject: `How's your Tarhunna trial going, ${firstName}?`,
    html: wrap(`
      ${p(`Hi ${firstName},`)}
      ${p(`You're one week into your Tarhunna trial for <strong>${orgName}</strong>. Nice work getting started.`)}
      ${p(`Here's what you have access to:`)}
      <ul style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.8;">
        <li>Lead capture forms to collect new inquiries automatically</li>
        <li>CRM &amp; pipeline to track every lead from first contact to booked procedure</li>
        <li>Consultation scheduling and automated reminders</li>
        <li>Email automations that follow up on autopilot</li>
      </ul>
      ${p(`You have 7 days left on your trial. Subscribe anytime to keep full access.`)}
      <p style="margin:24px 0 8px 0;">${btn('Go to your dashboard', `${APP_URL}/dashboard`)}</p>
      <p style="margin:8px 0 0 0;">${btn('Subscribe now', `${APP_URL}/settings`)}</p>
    `),
  }
}

function email3d(firstName: string, orgName: string, loop: boolean) {
  if (loop) return {
    subject: `Su prueba de Tarhunna termina en 3 días`,
    html: wrapEs(`
      ${p(`Hola ${firstName},`)}
      ${p(`Su prueba gratis de 14 días para <strong>${orgName}</strong> termina en 3 días.`)}
      ${p(`Para seguir enviando estimados y cobrando, suscríbase por <strong>$39/mes</strong>. Sus datos no se borran — la cuenta solo queda en pausa si no se suscribe.`)}
      <p style="margin:24px 0 0 0;">${btn('Suscribirse — $39/mes', `${APP_URL}/settings`)}</p>
      ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">Cancele cuando quiera, sin contratos. Nunca le cobramos sin avisarle primero.</span>`)}
    `),
  }
  return {
    subject: `Your Tarhunna trial ends in 3 days`,
    html: wrap(`
      ${p(`Hi ${firstName},`)}
      ${p(`Your 14-day free trial for <strong>${orgName}</strong> ends in 3 days.`)}
      ${p(`After that, you won't be able to access your leads, pipeline, consultations, or automations without an active subscription. Subscribe now to keep everything running without interruption.`)}
      <p style="margin:24px 0 0 0;">${btn('Subscribe now — $297/month', `${APP_URL}/settings`)}</p>
      ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">Questions before subscribing? Just reply to this email.</span>`)}
    `),
  }
}

function email1d(firstName: string, orgName: string, loop: boolean) {
  if (loop) return {
    subject: `Última oportunidad — su prueba termina mañana`,
    html: wrapEs(`
      ${p(`Hola ${firstName},`)}
      ${p(`Su prueba de Tarhunna para <strong>${orgName}</strong> termina mañana.`)}
      ${p(`Al terminar, la cuenta queda en pausa hasta que se suscriba ($39/mes). Sus estimados, clientes y cobros lo esperan intactos.`)}
      <p style="margin:24px 0 0 0;">${btn('Suscribirse — $39/mes', `${APP_URL}/settings`, '#028090')}</p>
      ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">Cancele cuando quiera, sin contratos.</span>`)}
    `),
  }
  return {
    subject: `Last chance — your Tarhunna trial ends tomorrow`,
    html: wrap(`
      ${p(`Hi ${firstName},`)}
      ${p(`Your Tarhunna trial for <strong>${orgName}</strong> expires tomorrow.`)}
      ${p(`Once it ends, your account will be restricted until you subscribe. Don't lose access to your leads and pipeline.`)}
      <p style="margin:24px 0 0 0;">${btn('Subscribe before you lose access', `${APP_URL}/settings`, '#dc2626')}</p>
    `),
  }
}

function emailExpired(firstName: string, orgName: string, loop: boolean) {
  if (loop) return {
    subject: `Su prueba de Tarhunna terminó`,
    html: wrapEs(`
      ${p(`Hola ${firstName},`)}
      ${p(`Su prueba de 14 días para <strong>${orgName}</strong> terminó y la cuenta está en pausa.`)}
      ${p(`Suscríbase por $39/mes para seguir cobrando y enviando estimados. <strong>Sus datos están a salvo — no se borró nada.</strong>`)}
      <p style="margin:24px 0 0 0;">${btn('Reactivar mi cuenta — $39/mes', `${APP_URL}/settings`, '#028090')}</p>
      ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">Cancele cuando quiera, sin contratos.</span>`)}
    `),
  }
  return {
    subject: `Your Tarhunna trial has ended`,
    html: wrap(`
      ${p(`Hi ${firstName},`)}
      ${p(`Your 14-day trial for <strong>${orgName}</strong> has ended and your account is now restricted.`)}
      ${p(`Subscribe to restore full access to your leads, pipeline, consultations, and automations. Your data is safe — nothing has been deleted.`)}
      <p style="margin:24px 0 0 0;">${btn('Restore full access', `${APP_URL}/settings`, '#dc2626')}</p>
    `),
  }
}

// ── Send helper ───────────────────────────────────────────────

async function sendBatch(
  orgs: { id: string; name: string; vertical: string | null }[],
  buildEmail: (firstName: string, orgName: string, loop: boolean) => { subject: string; html: string },
  sentAtColumn: string,
) {
  for (const org of orgs) {
    try {
      // Loop FAMILY, not a hardcoded pair — cleaning (and every future
      // loop vertical) must get the Spanish loop emails, not the clinic
      // variant.
      const loop = isLoopVertical(org.vertical)
      // Shared helper (org-owner.ts): the old maybeSingle() here broke
      // silently on two-owner orgs — no reminder emails, forever.
      const owner = await getOrgOwner(org.id)
      if (!owner) continue

      // Claim the reminder atomically (audit M4): only the tick that flips
      // the sent-at column from NULL wins. A racing/overlapping tick's
      // conditional UPDATE matches 0 rows and skips, so the email is sent
      // exactly once — replacing the old "SELECT null → send → stamp"
      // sequence that let two ticks both send.
      const claimIso = new Date().toISOString()
      const { data: claimed } = await supabaseAdmin
        .from('organizations')
        .update({ [sentAtColumn]: claimIso, updated_at: claimIso } as TablesUpdate<'organizations'>)
        .eq('id', org.id)
        .is(sentAtColumn, null)
        .select('id')
        .maybeSingle()
      if (!claimed) continue

      const firstName = (owner.full_name ?? '').split(' ')[0] || (loop ? 'hola' : 'there')
      const { subject, html } = buildEmail(firstName, org.name, loop)

      try {
        // Deterministic key: any accidental re-send inside Resend's 24h
        // dedup window collapses instead of double-emailing the owner.
        await sendEmail({ to: owner.email, subject, html, idempotencyKey: `trial:${sentAtColumn}:${org.id}` })
      } catch (sendErr) {
        // Release the claim so a later tick retries the send; the
        // deterministic key keeps that retry from duplicating.
        await supabaseAdmin
          .from('organizations')
          .update({ [sentAtColumn]: null } as TablesUpdate<'organizations'>)
          .eq('id', org.id)
          .eq(sentAtColumn, claimIso)
        throw sendErr
      }

    } catch (err: any) {
      console.error(`[trial-reminders] Failed for org ${org.id} (${sentAtColumn}):`, err.message)
    }
  }
}

// ── Main export ───────────────────────────────────────────────

export async function sendTrialReminders() {
  // Audit M4: this runs on the every-minute /api/cron. Serialize it with a
  // cron lock so two overlapping ticks can't both send (the per-org CAS in
  // sendBatch is the durable guard; the lock is the cheap stopgap).
  return withCronLock('sendTrialReminders', 90, async () => {
  const now     = new Date()
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const in1Day  = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000)

  // 7-day reminder: trial ends in ≤7 days but hasn't expired yet
  const { data: orgs7d } = await supabaseAdmin
    .from('organizations')
    .select('id, name, vertical')
    .eq('plan_status', 'trial')
    .is('trial_reminder_7d_sent_at', null)
    .lte('trial_ends_at', in7Days.toISOString())
    .gt('trial_ends_at', now.toISOString())

  // 3-day reminder
  const { data: orgs3d } = await supabaseAdmin
    .from('organizations')
    .select('id, name, vertical')
    .eq('plan_status', 'trial')
    .is('trial_reminder_3d_sent_at', null)
    .lte('trial_ends_at', in3Days.toISOString())
    .gt('trial_ends_at', now.toISOString())

  // 1-day reminder
  const { data: orgs1d } = await supabaseAdmin
    .from('organizations')
    .select('id, name, vertical')
    .eq('plan_status', 'trial')
    .is('trial_reminder_1d_sent_at', null)
    .lte('trial_ends_at', in1Day.toISOString())
    .gt('trial_ends_at', now.toISOString())

  // Expired: trial_ends_at has passed, plan is still trial or trial_expired
  const { data: orgsExpired } = await supabaseAdmin
    .from('organizations')
    .select('id, name, vertical')
    .in('plan_status', ['trial', 'trial_expired'])
    .is('trial_expired_email_sent_at', null)
    .lte('trial_ends_at', now.toISOString())

  await Promise.all([
    sendBatch(orgs7d     ?? [], email7d,       'trial_reminder_7d_sent_at'),
    sendBatch(orgs3d     ?? [], email3d,       'trial_reminder_3d_sent_at'),
    sendBatch(orgs1d     ?? [], email1d,       'trial_reminder_1d_sent_at'),
    sendBatch(orgsExpired ?? [], emailExpired, 'trial_expired_email_sent_at'),
  ])
  })
}
