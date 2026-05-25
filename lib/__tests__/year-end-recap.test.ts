// @vitest-environment node
import { describe, expect, it } from "vitest"
import { aggregateYearEndRecap, monthsToSaveThroughYearEnd } from "../year-end-recap"

describe("aggregateYearEndRecap", () => {
  it("projects 2030 balance from asOf month, not recap year", () => {
    const stats = aggregateYearEndRecap({
      year: 2025,
      closedGoals: [
        {
          periodKey: "2025-06",
          actualSavedAmount: 100,
          achievedGoal: true,
          closedAt: new Date("2025-07-01T00:00:00.000Z"),
        },
      ],
      achievementsInYear: 0,
      currentSavingsBalance: 1000,
      monthlySaveRate: 100,
      asOf: new Date("2026-01-15T00:00:00.000Z"),
    })

    // Jan 2026 → Dec 2030: 60 monthly saves at $100/mo on $1000 base
    expect(stats.projection2030).toBe(7000)
  })

  it("monthsToSaveThroughYearEnd is zero when already in the target year", () => {
    expect(monthsToSaveThroughYearEnd(new Date("2030-12-15T00:00:00.000Z"), 2030)).toBe(0)
    const stats = aggregateYearEndRecap({
      year: 2029,
      closedGoals: [],
      achievementsInYear: 0,
      currentSavingsBalance: 5000,
      monthlySaveRate: 100,
      asOf: new Date("2030-12-15T00:00:00.000Z"),
    })
    expect(stats.projection2030).toBe(5000)
  })
})
