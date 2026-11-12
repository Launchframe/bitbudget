import { describe, expect, it } from "vitest"
import { retroMissedPaycheckGrossUsd, retroPayPeriodElapsedFraction } from "@/lib/retro-paycheck-proration"

describe("retroPayPeriodElapsedFraction", () => {
  it("monthly cadence without paydays uses day-of-month fraction", () => {
    const run = new Date(Date.UTC(2026, 5, 15, 12, 0, 0))
    const f = retroPayPeriodElapsedFraction(
      { payCadence: "monthly", payDays: [], payDayOfWeek: null, lastPaydayAt: null },
      run,
      true,
    )
    expect(f).toBeCloseTo(15 / 30, 5)
  })
})

describe("retroMissedPaycheckGrossUsd", () => {
  it("returns prorated slice for monthly income", () => {
    const run = new Date(Date.UTC(2026, 5, 10, 12, 0, 0))
    const g = retroMissedPaycheckGrossUsd(
      3000,
      {
        monthlyIncome: 3000,
        payCadence: "monthly",
        payDays: [],
        payDayOfWeek: null,
        lastPaydayAt: null,
      },
      run,
      true,
    )
    expect(g).toBeGreaterThan(0)
    expect(g).toBeLessThanOrEqual(3000)
  })
})
