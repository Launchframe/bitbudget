/**
 * Premium trial / membership expiry calendar semantics and renewal reminder windows.
 *
 * Access includes the full UTC calendar expiry date plus until 04:00 UTC the following day.
 */

export const PREMIUM_EXPIRY_GRACE_UTC_HOUR = 4

/** Outbound + in-app reminder offsets (days before calendar expiry date). */
export const PREMIUM_RENEWAL_REMINDER_DAYS = [14, 3, 1] as const

export type PremiumRenewalReminderDay = (typeof PREMIUM_RENEWAL_REMINDER_DAYS)[number]
export type PremiumRenewalReminderKind = PremiumRenewalReminderDay | "expired"

export type PremiumExpirySource = "trial" | "gratis" | "membership"

/** User-facing population for copy variants. */
export type PremiumExpiryPopulation = "trial" | "membership"

export interface TimedPremiumExpiryRow {
  subscriptionTier: string
  premiumTrialUntil: Date | null
  premiumGratisUntil: Date | null
  premiumMembershipUntil: Date | null
}

export interface ActivePremiumExpiry {
  source: PremiumExpirySource
  population: PremiumExpiryPopulation
  expiryInstant: Date
  calendarExpiryUtc: Date
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function addUtcDays(d: Date, days: number): Date {
  const x = new Date(d.getTime())
  x.setUTCDate(x.getUTCDate() + days)
  return x
}

/** UTC calendar date (midnight) of the stored expiry instant. */
export function calendarExpiryUtcDate(expiryInstant: Date): Date {
  return startOfUtcDay(expiryInstant)
}

/** Last moment premium access remains active (04:00 UTC day after calendar expiry). */
export function premiumAccessEndsAt(expiryInstant: Date): Date {
  const cal = calendarExpiryUtcDate(expiryInstant)
  const graceDay = addUtcDays(cal, 1)
  return new Date(
    Date.UTC(
      graceDay.getUTCFullYear(),
      graceDay.getUTCMonth(),
      graceDay.getUTCDate(),
      PREMIUM_EXPIRY_GRACE_UTC_HOUR,
      0,
      0,
      0,
    ),
  )
}

export function isTimedPremiumAccessActive(expiryInstant: Date | null, now: Date = new Date()): boolean {
  if (!expiryInstant) return false
  return now.getTime() < premiumAccessEndsAt(expiryInstant).getTime()
}

export function formatPremiumExpiryCalendarDate(expiryInstant: Date): string {
  return calendarExpiryUtcDate(expiryInstant).toISOString().slice(0, 10)
}

export function utcDayWindowForCalendarDate(targetDayStart: Date): { gte: Date; lt: Date } {
  const gte = startOfUtcDay(targetDayStart)
  return { gte, lt: addUtcDays(gte, 1) }
}

/** Whole UTC calendar days from `now` until expiry date (0 = expires today). */
export function calendarDaysUntilExpiry(expiryInstant: Date, now: Date = new Date()): number {
  const today = startOfUtcDay(now).getTime()
  const expiryDay = calendarExpiryUtcDate(expiryInstant).getTime()
  return Math.round((expiryDay - today) / 86400000)
}

export function reminderKindForDaysLeft(
  daysLeft: number,
): PremiumRenewalReminderDay | null {
  if (daysLeft === 14 || daysLeft === 3 || daysLeft === 1) return daysLeft
  return null
}

/** True on the UTC calendar day after the expiry date (expired notification day). */
export function isExpiredNotificationDay(expiryInstant: Date, now: Date = new Date()): boolean {
  const today = startOfUtcDay(now)
  const expiryDay = calendarExpiryUtcDate(expiryInstant)
  const dayAfterExpiry = addUtcDays(expiryDay, 1)
  return today.getTime() === dayAfterExpiry.getTime()
}

export function premiumRenewalLogKey(
  source: PremiumExpirySource,
  expiryInstant: Date,
  kind: PremiumRenewalReminderKind,
): string {
  return `${source}:${formatPremiumExpiryCalendarDate(expiryInstant)}:${kind}`
}

export function sourceToPopulation(source: PremiumExpirySource): PremiumExpiryPopulation {
  return source === "trial" ? "trial" : "membership"
}

/**
 * Resolve the timed premium expiry driving renewal reminders (soonest calendar expiry among active sources).
 */
export function resolveActivePremiumExpiry(
  row: TimedPremiumExpiryRow,
  now: Date = new Date(),
): ActivePremiumExpiry | null {
  const candidates: ActivePremiumExpiry[] = []

  if (
    row.subscriptionTier === "premium" &&
    row.premiumMembershipUntil &&
    isTimedPremiumAccessActive(row.premiumMembershipUntil, now)
  ) {
    candidates.push({
      source: "membership",
      population: "membership",
      expiryInstant: row.premiumMembershipUntil,
      calendarExpiryUtc: calendarExpiryUtcDate(row.premiumMembershipUntil),
    })
  }

  if (row.premiumGratisUntil && isTimedPremiumAccessActive(row.premiumGratisUntil, now)) {
    candidates.push({
      source: "gratis",
      population: "membership",
      expiryInstant: row.premiumGratisUntil,
      calendarExpiryUtc: calendarExpiryUtcDate(row.premiumGratisUntil),
    })
  }

  if (row.premiumTrialUntil && isTimedPremiumAccessActive(row.premiumTrialUntil, now)) {
    candidates.push({
      source: "trial",
      population: "trial",
      expiryInstant: row.premiumTrialUntil,
      calendarExpiryUtc: calendarExpiryUtcDate(row.premiumTrialUntil),
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.calendarExpiryUtc.getTime() - b.calendarExpiryUtc.getTime())
  return candidates[0]!
}

/** Most recently lapsed timed premium (for expired banner), if grace has ended. */
export function resolveRecentlyLapsedPremiumExpiry(
  row: TimedPremiumExpiryRow,
  now: Date = new Date(),
): ActivePremiumExpiry | null {
  const candidates: ActivePremiumExpiry[] = []

  const pushIfLapsed = (source: PremiumExpirySource, population: PremiumExpiryPopulation, until: Date | null) => {
    if (!until) return
    const endsAt = premiumAccessEndsAt(until)
    if (now.getTime() >= endsAt.getTime()) {
      candidates.push({
        source,
        population,
        expiryInstant: until,
        calendarExpiryUtc: calendarExpiryUtcDate(until),
      })
    }
  }

  pushIfLapsed("membership", "membership", row.premiumMembershipUntil)
  pushIfLapsed("gratis", "membership", row.premiumGratisUntil)
  pushIfLapsed("trial", "trial", row.premiumTrialUntil)

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.calendarExpiryUtc.getTime() - a.calendarExpiryUtc.getTime())
  return candidates[0]!
}

export function expiryInstantInUtcDayWindow(
  expiryInstant: Date,
  window: { gte: Date; lt: Date },
): boolean {
  const t = expiryInstant.getTime()
  return t >= window.gte.getTime() && t < window.lt.getTime()
}
