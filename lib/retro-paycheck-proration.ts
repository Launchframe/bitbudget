/**
 * Prorated gross for a single "missed" paycheck catch-up (UTC calendar).
 */

import {
  daysInUtcMonth,
  grossIncomeForFundingRun,
  grossIncomeForPaydayUser,
  paydayDomListInUtcMonth,
} from "@/lib/envelope-funding-period"
import { usesPaydayCadence, type PaydayUserFields } from "@/lib/payday-cadence"

export interface RetroPaycheckUserInput {
  monthlyIncome: number
  payCadence: string
  payDays: number[]
  payDayOfWeek: number | null
  lastPaydayAt: Date | null
}

function utcNoon(y: number, m: number, dom: number): Date {
  return new Date(Date.UTC(y, m, dom, 12, 0, 0))
}

/**
 * Elapsed fraction of the current pay period (0–1], used to scale one paycheck slice.
 * - Non–payday cadences (monthly/bimonthly/daily): fraction of the current calendar slice.
 * - Explicit paydays: days since last payday / days until next payday (clamped).
 */
export function retroPayPeriodElapsedFraction(
  user: PaydayUserFields,
  runDateUtc: Date,
  dailyCadenceAllowed: boolean,
): number {
  const y = runDateUtc.getUTCFullYear()
  const m = runDateUtc.getUTCMonth()
  const dom = runDateUtc.getUTCDate()
  const dim = daysInUtcMonth(runDateUtc)

  if (user.payCadence === "irregular" || user.payCadence === "mixed") return 0

  if (!usesPaydayCadence(user)) {
    if (user.payCadence === "monthly") {
      return Math.min(1, Math.max(1 / dim, dom / dim))
    }
    if (user.payCadence === "bimonthly") {
      if (dom <= 15) return Math.min(1, Math.max(1 / 15, dom / 15))
      const secondHalfDays = dim - 15
      const pos = dom - 15
      return Math.min(1, Math.max(1 / Math.max(1, secondHalfDays), pos / Math.max(1, secondHalfDays)))
    }
    if (user.payCadence === "daily") {
      if (!dailyCadenceAllowed) return 0
      return Math.min(1, Math.max(1 / dim, dom / dim))
    }
    return Math.min(1, Math.max(1 / dim, dom / dim))
  }

  const paydays = paydayDomListInUtcMonth(user, y, m).sort((a, b) => a - b)
  if (paydays.length === 0) return 0

  const prevDom = [...paydays].filter((d) => d <= dom).pop()
  const nextDom = paydays.find((d) => d > dom)

  if (prevDom === undefined) {
    const first = paydays[0]!
    const periodLen = Math.max(1, first)
    const elapsed = Math.max(1, dom)
    return Math.min(1, elapsed / periodLen)
  }

  const startDom = prevDom
  const endDom = nextDom ?? dim + 1
  const periodLen = Math.max(1, endDom - startDom)
  const elapsed = Math.max(1, dom - startDom + 1)
  return Math.min(1, elapsed / periodLen)
}

/** One paycheck / funding-run slice in USD (unprorated), as of `runDateUtc`. */
export function retroBasePaycheckSliceUsd(
  monthlyIncome: number,
  user: PaydayUserFields,
  runDateUtc: Date,
  dailyCadenceAllowed: boolean,
): number {
  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) return 0

  if (usesPaydayCadence(user)) {
    const y = runDateUtc.getUTCFullYear()
    const m = runDateUtc.getUTCMonth()
    const paydays = paydayDomListInUtcMonth(user, y, m)
    if (paydays.length === 0) return 0
    const dom = runDateUtc.getUTCDate()
    const onPayday = paydays.includes(dom)
    const refDom = onPayday ? dom : paydays.filter((d) => d <= dom).pop() ?? paydays[0]!
    const refDate = utcNoon(y, m, refDom)
    const paydaysInMonth = paydayDomListInUtcMonth(user, y, m)
    return grossIncomeForPaydayUser(
      monthlyIncome,
      user,
      refDate,
      dailyCadenceAllowed,
      paydaysInMonth,
    )
  }

  return grossIncomeForFundingRun(monthlyIncome, user.payCadence, runDateUtc, dailyCadenceAllowed)
}

/** Prorated gross USD for the retro missed-paycheck catch-up. */
export function retroMissedPaycheckGrossUsd(
  monthlyIncome: number,
  user: RetroPaycheckUserInput,
  runDateUtc: Date,
  dailyCadenceAllowed: boolean,
): number {
  const paydayUser: PaydayUserFields = {
    payCadence: user.payCadence,
    payDays: user.payDays,
    payDayOfWeek: user.payDayOfWeek,
    lastPaydayAt: user.lastPaydayAt,
  }

  const base = retroBasePaycheckSliceUsd(monthlyIncome, paydayUser, runDateUtc, dailyCadenceAllowed)
  if (base <= 0) return 0

  const frac = retroPayPeriodElapsedFraction(paydayUser, runDateUtc, dailyCadenceAllowed)
  if (frac <= 0) return 0

  return Math.round(base * frac * 100) / 100
}
