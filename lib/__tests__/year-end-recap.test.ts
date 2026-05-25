// @vitest-environment node
import { describe, expect, it } from "vitest"
import { aggregateYearEndRecap } from "../year-end-recap"

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
})
