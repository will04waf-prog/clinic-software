/**
 * Phase 4 W8 — invitation email body.
 *
 * Plain-text-flavored email wrapped in our existing HTML shell.
 * The receiving inbox is a clinic employee (front-desk staff or
 * a med-spa admin), not a patient — so the copy is direct and the
 * subject is action-oriented.
 *
 * The CTA links to /accept-invite?token=... — that page reads the
 * token from the query string and lets the invitee set a password.
 */

import { wrapEmailHtml } from '@/lib/resend'

export interface InvitationEmail {
  subject: string
  html:    string
  /** Plain-text version of the body. Most email clients render the
   *  HTML; this is the fallback for text-only clients + a11y. */
  text:    string
}

export function buildInvitationEmail(args: {
  orgName: string
  inviterFullName: string | null
  role: 'admin' | 'staff'
  acceptUrl: string
  expiresAt: Date
}): InvitationEmail {
  const inviter = args.inviterFullName?.trim() || 'A teammate'
  const roleHuman = args.role === 'admin' ? 'Admin' : 'Staff'
  const expiresHuman = args.expiresAt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const subject = `You've been invited to ${args.orgName} on ClinIQ`

  const bodyLines = [
    `${inviter} invited you to join ${args.orgName} as a ${roleHuman}.`,
    `Set up your account and start working in the dashboard:`,
    args.acceptUrl,
    `This invitation expires on ${expiresHuman}.`,
    `If you weren't expecting this email, you can safely ignore it.`,
  ]

  return {
    subject,
    html:  wrapEmailHtml(bodyLines.join('\n'), args.orgName),
    text:  bodyLines.join('\n\n'),
  }
}
