import { getCurrentMonthKey } from "@/lib/data"
import { SAVINGS_GOAL_DEFAULT_PERIOD } from "@/lib/savings-goal"
import type { SavingsGoalRow } from "@/lib/savings-ui-metrics"

export function shiftPeriodKey(periodKey: string, deltaMonths: number): string {
  if (periodKey === SAVINGS_GOAL_DEFAULT_PERIOD) return periodKey
  const [y, m] = periodKey.split("-").map(Number)
  const d = new Date(y, m - 1 + deltaMonths, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export function comparePeriodKeys(a: string, b: string): number {
  return a.localeCompare(b)
}

/** Inclusive month keys from first tracked goal month through current month. */
export function buildPastGoalsMonthRange(
  goals: readonly SavingsGoalRow[],
  currentMonthKey: string = getCurrentMonthKey(),
): string[] {
  const periodKeys = goals
    .map((g) => g.periodKey)
    .filter((k) => k !== SAVINGS_GOAL_DEFAULT_PERIOD && /^\d{4}-\d{2}$/.test(k))

  const first =
    periodKeys.length > 0
      ? periodKeys.reduce((min, k) => (comparePeriodKeys(k, min) < 0 ? k : min))
      : currentMonthKey

  const start = comparePeriodKeys(first, currentMonthKey) <= 0 ? first : currentMonthKey
  const keys: string[] = []
  let cursor = start
  while (comparePeriodKeys(cursor, currentMonthKey) <= 0) {
    keys.push(cursor)
    if (cursor === currentMonthKey) break
    cursor = shiftPeriodKey(cursor, 1)
  }
  return keys
}

export function achievementEarnedInMonth(earnedAtIso: string, periodKey: string): boolean {
  const d = new Date(earnedAtIso)
  if (!Number.isFinite(d.getTime())) return false
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  return month === periodKey
}
