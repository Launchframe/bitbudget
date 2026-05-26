/**
 * Resolves how BitBudget reaches a user for non-security notifications.
 * Login `email` and verified notification-only addresses are separate for Nostr accounts.
 * Email and Nostr DM channels are independent — both may be used when configured.
 */

export type NotificationEmailRow = {
  email: string
  verifiedAt?: Date | string | null
}

export type NotificationContactUser = {
  email?: string | null
  notificationEmails?: NotificationEmailRow[] | null
  nostrPubkey?: string | null
  nostrDmEnabled?: boolean | null
}

export const MAX_NOTIFICATION_EMAILS_PER_USER = 10

/** Conservative email shape check; rejects whitespace/control chars and invalid formats. */
const NOTIFICATION_EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

export function normalizeNotificationEmail(email: string): string {
  return email.toLowerCase().trim()
}

/** Returns a normalized notification email or null when the input is invalid. */
export function parseNotificationEmail(email: string): string | null {
  const trimmed = email.trim()
  if (!trimmed || trimmed.length > 254) return null
  if (/\s/.test(trimmed) || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  const normalized = trimmed.toLowerCase()
  if (!NOTIFICATION_EMAIL_RE.test(normalized)) return null
  return normalized
}

export function isNotificationEmailVerified(
  verified: Date | string | null | undefined,
): boolean {
  if (!verified) return false
  if (verified instanceof Date) return !Number.isNaN(verified.getTime())
  const parsed = Date.parse(verified)
  return !Number.isNaN(parsed)
}

/** All addresses that should receive notification emails (login + verified notification-only). */
export function outboundNotificationEmails(user: NotificationContactUser): string[] {
  const seen = new Set<string>()
  const add = (raw: string | null | undefined) => {
    const trimmed = raw?.trim()
    if (!trimmed) return
    const normalized = normalizeNotificationEmail(trimmed)
    if (!seen.has(normalized)) seen.add(normalized)
  }

  add(user.email)

  for (const row of user.notificationEmails ?? []) {
    if (isNotificationEmailVerified(row.verifiedAt)) {
      add(row.email)
    }
  }

  return [...seen]
}

/** @deprecated Use {@link outboundNotificationEmails}; returns first address or null. */
export function outboundNotificationEmail(user: NotificationContactUser): string | null {
  return outboundNotificationEmails(user)[0] ?? null
}

export function userAllowsNostrDm(user: NotificationContactUser): boolean {
  return Boolean(user.nostrDmEnabled && user.nostrPubkey?.trim())
}

export function userHasEmailNotificationChannel(user: NotificationContactUser): boolean {
  return outboundNotificationEmails(user).length > 0
}

export function userHasAnyNotificationChannel(user: NotificationContactUser): boolean {
  return userHasEmailNotificationChannel(user) || userAllowsNostrDm(user)
}
