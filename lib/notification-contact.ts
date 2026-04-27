/**
 * Resolves how BitBudget reaches a user for non-security notifications.
 * Login `email` and verified `notificationEmail` are distinct for Nostr-only accounts.
 */

export type NotificationContactUser = {
  email?: string | null
  notificationEmail?: string | null
  notificationEmailVerified?: Date | string | null
  nostrPubkey?: string | null
  nostrDmEnabled?: boolean | null
}

export function normalizeNotificationEmail(email: string): string {
  return email.toLowerCase().trim()
}

export function isNotificationEmailVerified(
  verified: Date | string | null | undefined,
): boolean {
  if (!verified) return false
  if (verified instanceof Date) return !Number.isNaN(verified.getTime())
  const parsed = Date.parse(verified)
  return !Number.isNaN(parsed)
}

/** Verified notification-only address, or login email when present. */
export function outboundNotificationEmail(user: NotificationContactUser): string | null {
  const loginEmail = user.email?.trim()
  if (loginEmail) return loginEmail

  const notificationEmail = user.notificationEmail?.trim()
  if (notificationEmail && isNotificationEmailVerified(user.notificationEmailVerified)) {
    return notificationEmail
  }
  return null
}

export function userAllowsNostrDm(user: NotificationContactUser): boolean {
  return Boolean(user.nostrDmEnabled && user.nostrPubkey?.trim())
}

export function userHasEmailNotificationChannel(user: NotificationContactUser): boolean {
  return outboundNotificationEmail(user) !== null
}
