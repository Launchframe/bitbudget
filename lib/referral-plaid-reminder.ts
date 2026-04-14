const PREFIX = "bitbudget-ref-plaid-snooze"

export function referralPlaidReminderSnoozeKey(userId: string): string {
  return `${PREFIX}:${userId}`
}

export function getReferralPlaidSnoozeUntilMs(userId: string | null): number | null {
  if (!userId || typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(referralPlaidReminderSnoozeKey(userId))
    if (!raw) return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function isReferralPlaidReminderSnoozed(userId: string | null, now: number = Date.now()): boolean {
  const until = getReferralPlaidSnoozeUntilMs(userId)
  return until != null && until > now
}

/** Hide the dashboard reminder until this many days pass (per user, this browser). */
export function snoozeReferralPlaidReminder(userId: string | null, days: number = 4): void {
  if (!userId || typeof window === "undefined") return
  try {
    const until = Date.now() + Math.max(1, Math.floor(days)) * 86400000
    localStorage.setItem(referralPlaidReminderSnoozeKey(userId), String(until))
  } catch {
    /* ignore */
  }
}
