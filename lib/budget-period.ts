/**
 * BudgetPeriod helpers (UTC calendar month). Safe on client and server.
 */

import { pad2 } from "@/lib/pad2"

/** True on UTC calendar day 1 (monthly sweep + gap top-up). */
export function isBudgetAllocationDay(date: Date): boolean {
  return date.getUTCDate() === 1
}

/** `YYYY-MM` for the run date's UTC calendar month. */
export function budgetPeriodKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  return `${y}-${pad2(m)}`
}

export function allocationBatchPeriodKey(date: Date): string {
  return `alloc-${budgetPeriodKey(date)}`
}

export function sweepBatchPeriodKey(date: Date): string {
  return `sweep-${budgetPeriodKey(date)}`
}

/** Paycheck batch idempotency (PayPeriod). */
export function paycheckBatchPeriodKey(runDateUtc: Date): string {
  const y = runDateUtc.getUTCFullYear()
  const m = runDateUtc.getUTCMonth() + 1
  const dom = runDateUtc.getUTCDate()
  return `pay-${y}-${pad2(m)}-${pad2(dom)}`
}

export function allocationTopUpAmount(params: {
  monthlyAllotment: number
  currentMonthBalance: number
}): number {
  const { monthlyAllotment, currentMonthBalance } = params
  if (!Number.isFinite(monthlyAllotment) || monthlyAllotment <= 0) return 0
  const balance = Number.isFinite(currentMonthBalance) ? currentMonthBalance : 0
  const gap = monthlyAllotment - balance
  if (gap <= 0) return 0
  return Math.round(gap * 100) / 100
}

/** Manual deficit cover only — brings month balance toward $0, not full allotment. */
export function deficitCoverAmount(currentMonthBalance: number): number {
  if (!Number.isFinite(currentMonthBalance) || currentMonthBalance >= 0) return 0
  return Math.round(-currentMonthBalance * 100) / 100
}
