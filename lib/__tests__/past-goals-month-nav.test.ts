import { describe, expect, it } from "vitest"
import {
  achievementEarnedInMonth,
  buildPastGoalsMonthRange,
  shiftPeriodKey,
} from "@/lib/past-goals-month-nav"
import type { SavingsGoalRow } from "@/lib/savings-ui-metrics"

describe("past-goals-month-nav", () => {
  it("shiftPeriodKey advances months", () => {
    expect(shiftPeriodKey("2026-01", 1)).toBe("2026-02")
    expect(shiftPeriodKey("2026-12", 1)).toBe("2027-01")
  })

  it("buildPastGoalsMonthRange spans first goal through current", () => {
    const goals: SavingsGoalRow[] = [
      {
        periodKey: "2025-11",
        targetAmount: 100,
        closedAt: "2025-12-01",
        achievedGoal: true,
      },
    ]
    const range = buildPastGoalsMonthRange(goals, "2026-02")
    expect(range[0]).toBe("2025-11")
    expect(range[range.length - 1]).toBe("2026-02")
    expect(range).toContain("2026-01")
  })

  it("achievementEarnedInMonth matches calendar month", () => {
    expect(achievementEarnedInMonth("2026-03-15T12:00:00.000Z", "2026-03")).toBe(true)
    expect(achievementEarnedInMonth("2026-03-15T12:00:00.000Z", "2026-02")).toBe(false)
  })
})
