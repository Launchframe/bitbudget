/**
 * Pure UTC calendar helpers for ledger funding runs (safe on client & server).
 */

import { isPaydayForUser, type PaydayUserFields } from "@/lib/payday-cadence"

export function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export function daysInUtcMonth(date: Date): number {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

/**
 * Split `monthTotalCents` across calendar days of that month so the sum matches exactly.
 * First `remainder` days receive `base+1` cents; others receive `base`.
 */
export function dailySliceFromMonthlyTotalCents(monthTotalCents: number, dim: number, dayOfMonth: number): number {
  if (dim <= 0 || dayOfMonth < 1 || dayOfMonth > dim) return 0
  const abs = Math.abs(monthTotalCents)
  const sign = monthTotalCents < 0 ? -1 : 1
  const base = Math.floor(abs / dim)
  const remainder = abs - base * dim
  const slice = dayOfMonth <= remainder ? base + 1 : base
  return sign * slice
}

/** Slice for monthly totals when cadence is daily (non-production testers). */
export function sliceMonthlyAmountForDailyRun(monthAmount: number, runDateUtc: Date): number {
  const dim = daysInUtcMonth(runDateUtc)
  const dom = runDateUtc.getUTCDate()
  const cents = Math.round(monthAmount * 100)
  const sliceCents = dailySliceFromMonthlyTotalCents(cents, dim, dom)
  return sliceCents / 100
}

/** Bimonthly: UTC days 1–15 vs 16–end; odd cent goes to the second half so both runs sum to the monthly total. */
export function sliceMonthlyAmountForBimonthlyRun(monthAmount: number, runDateUtc: Date): number {
  const cents = Math.round(monthAmount * 100)
  const dom = runDateUtc.getUTCDate()
  const firstHalf = dom <= 15
  const lowHalf = Math.floor(cents / 2)
  const sliceCents = firstHalf ? lowHalf : cents - lowHalf
  return sliceCents / 100
}

/** Period key for idempotent funding batches; `null` when daily cadence not allowed at runtime. */
export function fundingPeriodKeyForDate(params: {
  payCadence: string
  runDateUtc: Date
  dailyCadenceAllowed: boolean
}): string | null {
  const { payCadence, runDateUtc, dailyCadenceAllowed } = params
  const y = runDateUtc.getUTCFullYear()
  const m = runDateUtc.getUTCMonth() + 1
  const dom = runDateUtc.getUTCDate()
  const ym = `${y}-${pad2(m)}`

  if (payCadence === "monthly") {
    return ym
  }
  if (payCadence === "bimonthly") {
    const half = dom <= 15 ? "a" : "b"
    return `${ym}-${half}`
  }
  if (payCadence === "daily") {
    if (!dailyCadenceAllowed) return null
    return `${ym}-${pad2(dom)}`
  }
  return null
}

/** Gross income amount for one funding run (USD). */
export function grossIncomeForFundingRun(
  monthlyIncome: number,
  payCadence: string,
  runDateUtc: Date,
  dailyCadenceAllowed: boolean,
): number {
  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) return 0
  if (payCadence === "monthly") return Math.round(monthlyIncome * 100) / 100
  if (payCadence === "bimonthly") return sliceMonthlyAmountForBimonthlyRun(monthlyIncome, runDateUtc)
  if (payCadence === "daily") {
    if (!dailyCadenceAllowed) return 0
    return sliceMonthlyAmountForDailyRun(monthlyIncome, runDateUtc)
  }
  return 0
}

/** Per-envelope allotment slice for one funding run (USD). */
export function allotmentSliceForFundingRun(
  monthlyAllotment: number,
  payCadence: string,
  runDateUtc: Date,
  dailyCadenceAllowed: boolean,
): number {
  if (!Number.isFinite(monthlyAllotment) || monthlyAllotment <= 0) return 0
  if (payCadence === "monthly") return Math.round(monthlyAllotment * 100) / 100
  if (payCadence === "bimonthly") return sliceMonthlyAmountForBimonthlyRun(monthlyAllotment, runDateUtc)
  if (payCadence === "daily") {
    if (!dailyCadenceAllowed) return 0
    return sliceMonthlyAmountForDailyRun(monthlyAllotment, runDateUtc)
  }
  return 0
}

/** UTC day-of-month numbers that are paydays for the user in a calendar month. */
export function paydayDomListInUtcMonth(
  user: PaydayUserFields,
  year: number,
  monthIndex: number,
): number[] {
  const dim = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const days: number[] = []
  for (let dom = 1; dom <= dim; dom++) {
    const d = new Date(Date.UTC(year, monthIndex, dom, 12, 0, 0))
    if (isPaydayForUser(user, d)) days.push(dom)
  }
  return days
}

/** Split a monthly total across the user's paydays in the run month (exact cents). */
export function sliceMonthlyAmountForPaydayRun(
  monthAmount: number,
  user: PaydayUserFields,
  runDateUtc: Date,
): number {
  if (!Number.isFinite(monthAmount) || monthAmount <= 0) return 0
  const y = runDateUtc.getUTCFullYear()
  const m = runDateUtc.getUTCMonth()
  const paydays = paydayDomListInUtcMonth(user, y, m)
  if (paydays.length === 0) return 0
  const dom = runDateUtc.getUTCDate()
  const index = paydays.indexOf(dom)
  if (index === -1) return 0
  const cents = Math.round(monthAmount * 100)
  const abs = Math.abs(cents)
  const sign = cents < 0 ? -1 : 1
  const base = Math.floor(abs / paydays.length)
  const remainder = abs - base * paydays.length
  const slice = index + 1 <= remainder ? base + 1 : base
  return (sign * slice) / 100
}

/** Gross income when funding uses explicit paydays (splits monthly income per payday). */
export function grossIncomeForPaydayUser(
  monthlyIncome: number,
  user: PaydayUserFields,
  runDateUtc: Date,
  dailyCadenceAllowed: boolean,
): number {
  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) return 0
  if (user.payCadence === "daily") {
    if (!dailyCadenceAllowed) return 0
    return sliceMonthlyAmountForDailyRun(monthlyIncome, runDateUtc)
  }
  return sliceMonthlyAmountForPaydayRun(monthlyIncome, user, runDateUtc)
}

/** Envelope allotment slice when funding uses explicit paydays. */
export function allotmentSliceForPaydayUser(
  monthlyAllotment: number,
  user: PaydayUserFields,
  runDateUtc: Date,
  dailyCadenceAllowed: boolean,
): number {
  if (!Number.isFinite(monthlyAllotment) || monthlyAllotment <= 0) return 0
  if (user.payCadence === "daily") {
    if (!dailyCadenceAllowed) return 0
    return sliceMonthlyAmountForDailyRun(monthlyAllotment, runDateUtc)
  }
  return sliceMonthlyAmountForPaydayRun(monthlyAllotment, user, runDateUtc)
}
