/**
 * Paycheck timing helpers (UTC). Used by funding cron and onboarding previews.
 */

import { pad2 } from "@/lib/pad2"

export interface PaydayUserFields {
  payCadence: string
  payDays: number[]
  payDayOfWeek: number | null
  lastPaydayAt: Date | null
}

/** True when funding/sweep should use explicit pay days or weekly/biweekly/daily cadence. */
export function usesPaydayCadence(user: Pick<PaydayUserFields, "payDays" | "payCadence">): boolean {
  if (user.payDays.length > 0) return true
  return user.payCadence === "weekly" || user.payCadence === "biweekly" || user.payCadence === "daily"
}

export const PAYDAY_LAST_OF_MONTH = 32

function effectiveDom(year: number, monthIndex: number, day: number): number {
  if (day === PAYDAY_LAST_OF_MONTH) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  }
  const dim = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Math.min(Math.max(1, day), dim)
}

function daysBetweenUtc(a: Date, b: Date): number {
  const ms =
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) -
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return Math.round(ms / 86_400_000)
}

export function isPaydayForUser(user: PaydayUserFields, today: Date): boolean {
  const cadence = user.payCadence
  if (cadence === "irregular" || cadence === "mixed") return false

  if (cadence === "monthly") {
    const dom = today.getUTCDate()
    const days = user.payDays.length > 0 ? user.payDays : [1]
    const y = today.getUTCFullYear()
    const m = today.getUTCMonth()
    return days.some(d => effectiveDom(y, m, d) === dom)
  }

  if (cadence === "bimonthly") {
    const dom = today.getUTCDate()
    const days = user.payDays.length >= 2 ? user.payDays.slice(0, 2) : [1, 16]
    const y = today.getUTCFullYear()
    const m = today.getUTCMonth()
    return days.some(d => effectiveDom(y, m, d) === dom)
  }

  if (cadence === "weekly") {
    return today.getUTCDay() === (user.payDayOfWeek ?? 5)
  }

  if (cadence === "biweekly") {
    const dow = user.payDayOfWeek ?? 5
    if (today.getUTCDay() !== dow) return false
    const anchor = user.lastPaydayAt
    if (!anchor) return false
    return Math.abs(daysBetweenUtc(today, anchor)) % 14 === 0
  }

  if (cadence === "daily") return true
  return false
}

export function fundingPeriodKeyForPayday(_user: PaydayUserFields, runDateUtc: Date): string | null {
  const y = runDateUtc.getUTCFullYear()
  const m = runDateUtc.getUTCMonth() + 1
  const dom = runDateUtc.getUTCDate()
  return `fund-${y}-${pad2(m)}-${pad2(dom)}`
}

export function sweepPeriodKeyForPayday(user: PaydayUserFields, runDateUtc: Date): string | null {
  const key = fundingPeriodKeyForPayday(user, runDateUtc)
  return key ? key.replace(/^fund-/, "sweep-") : null
}
