/** Prior calendar month for `YYYY-MM` keys; returns input unchanged when not a month key. */
export function previousMonthKey(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey
  const [y, m] = monthKey.split("-").map(Number)
  const prev = new Date(Date.UTC(y, m - 2, 1))
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`
}

type GoalStreakRow = {
  periodKey: string
  achievedGoal: boolean | null
  closedAt?: Date | string | null
}

/**
 * Current streak from the most recent closed month backward.
 * Breaks on a missed goal or a gap in calendar months (missing period row).
 */
export function currentGoalStreakFromClosed(closedGoals: GoalStreakRow[]): number {
  const sorted = [...closedGoals]
    .filter((g) => /^\d{4}-\d{2}$/.test(g.periodKey))
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))

  let streak = 0
  let expectedKey: string | null = null

  for (const row of sorted) {
    if (expectedKey !== null && row.periodKey !== expectedKey) break
    if (!row.achievedGoal) break
    streak++
    expectedKey = previousMonthKey(row.periodKey)
  }

  return streak
}

/**
 * Longest run of consecutive calendar months with achievedGoal=true.
 * Resets across gaps (missing months) as well as failed months.
 */
export function longestGoalStreakFromClosed(closedGoals: GoalStreakRow[]): number {
  const sorted = [...closedGoals]
    .filter((g) => /^\d{4}-\d{2}$/.test(g.periodKey) && g.closedAt)
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))

  let longest = 0
  let streak = 0
  let expectedNext: string | null = null

  for (const row of sorted) {
    if (!row.achievedGoal) {
      streak = 0
      expectedNext = null
      continue
    }

    if (expectedNext === null || row.periodKey === expectedNext) {
      streak++
      expectedNext = previousMonthKey(row.periodKey)
    } else {
      streak = 1
      expectedNext = previousMonthKey(row.periodKey)
    }

    longest = Math.max(longest, streak)
  }

  return longest
}
