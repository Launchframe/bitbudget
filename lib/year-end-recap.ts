import { longestGoalStreakFromClosed } from "@/lib/savings-goal-streak"

type RecapGoalRow = {
  periodKey: string
  actualSavedAmount: number | null
  achievedGoal: boolean | null
  closedAt: Date | null
}

export interface YearEndRecapStats {
  year: number
  totalSaved: number
  bestMonth: { periodKey: string; amount: number } | null
  worstMonth: { periodKey: string; amount: number } | null
  longestStreak: number
  achievementsEarned: number
  projection2030: number | null
}

/** Monthly save periods from asOf through December of targetYear. Returns 0 when asOf is already in targetYear (2030 projection uses current balance only, no forward saves within that calendar year). */
export function monthsToSaveThroughYearEnd(asOf: Date, targetYear: number): number {
  const year = asOf.getUTCFullYear()
  const month = asOf.getUTCMonth()
  if (year > targetYear) return 0
  if (year === targetYear) return 0
  return (targetYear - year) * 12 + (12 - month)
}

export function aggregateYearEndRecap(params: {
  year: number
  closedGoals: RecapGoalRow[]
  achievementsInYear: number
  currentSavingsBalance: number
  monthlySaveRate: number
  /** UTC anchor for 2030 projection; defaults to now (matches current balance). */
  asOf?: Date
}): YearEndRecapStats {
  const yearPrefix = `${params.year}-`
  const inYear = params.closedGoals.filter(
    (g) => g.periodKey.startsWith(yearPrefix) && g.actualSavedAmount != null,
  )

  let totalSaved = 0
  let bestMonth: { periodKey: string; amount: number } | null = null
  let worstMonth: { periodKey: string; amount: number } | null = null

  for (const row of inYear) {
    const amt = Number(row.actualSavedAmount)
    totalSaved += amt
    if (!bestMonth || amt > bestMonth.amount) bestMonth = { periodKey: row.periodKey, amount: amt }
    if (!worstMonth || amt < worstMonth.amount) worstMonth = { periodKey: row.periodKey, amount: amt }
  }

  const longestStreak = longestGoalStreakFromClosed(inYear)

  const rate = params.monthlySaveRate
  let projection2030: number | null = null
  if (rate > 0) {
    const asOf = params.asOf ?? new Date()
    const monthsTo2030 = monthsToSaveThroughYearEnd(asOf, 2030)
    projection2030 = Math.round((params.currentSavingsBalance + rate * monthsTo2030) * 100) / 100
  }

  return {
    year: params.year,
    totalSaved: Math.round(totalSaved * 100) / 100,
    bestMonth,
    worstMonth,
    longestStreak,
    achievementsEarned: params.achievementsInYear,
    projection2030,
  }
}

export function shouldShowYearEndRecap(now = new Date()): { show: boolean; recapYear: number } {
  const month = now.getUTCMonth()
  const day = now.getUTCDate()
  const year = now.getUTCFullYear()
  if (month === 0 && day >= 1) {
    return { show: true, recapYear: year - 1 }
  }
  return { show: false, recapYear: year - 1 }
}

export function yearEndRecapStorageKey(recapYear: number): string {
  return `bitbudget-year-end-recap-${recapYear}`
}
