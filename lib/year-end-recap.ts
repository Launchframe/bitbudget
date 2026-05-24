import type { SavingsGoal } from "@prisma/client"

export interface YearEndRecapStats {
  year: number
  totalSaved: number
  bestMonth: { periodKey: string; amount: number } | null
  worstMonth: { periodKey: string; amount: number } | null
  longestStreak: number
  achievementsEarned: number
  projection2030: number | null
}

export function aggregateYearEndRecap(params: {
  year: number
  closedGoals: Array<
    Pick<SavingsGoal, "periodKey" | "actualSavedAmount" | "achievedGoal" | "closedAt">
  >
  achievementsInYear: number
  currentSavingsBalance: number
  monthlySaveRate: number
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

  const sorted = [...inYear]
    .filter((g) => g.closedAt)
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))

  let longestStreak = 0
  let streak = 0
  for (const row of sorted) {
    if (row.achievedGoal) {
      streak++
      longestStreak = Math.max(longestStreak, streak)
    } else {
      streak = 0
    }
  }

  const rate = params.monthlySaveRate
  let projection2030: number | null = null
  if (rate > 0) {
    const monthsTo2030 = Math.max(0, (2030 - params.year) * 12)
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
  return `bitbudget-year-recap-${recapYear}`
}
