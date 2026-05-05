// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  allotmentSliceForFundingRun,
  dailySliceFromMonthlyTotalCents,
  daysInUtcMonth,
  fundingPeriodKeyForDate,
  grossIncomeForFundingRun,
  pad2,
  sliceMonthlyAmountForBimonthlyRun,
  sliceMonthlyAmountForDailyRun,
} from "../envelope-funding-period"

describe("envelope-funding-period", () => {
  it("pad2 zero-pads", () => {
    expect(pad2(3)).toBe("03")
    expect(pad2(12)).toBe("12")
  })

  it("dailySliceFromMonthlyTotalCents sums to month total", () => {
    const cents = 10001
    const dim = 31
    let sum = 0
    for (let d = 1; d <= dim; d++) {
      sum += dailySliceFromMonthlyTotalCents(cents, dim, d)
    }
    expect(sum).toBe(cents)
  })

  it("sliceMonthlyAmountForDailyRun splits across dim days", () => {
    const run = new Date(Date.UTC(2026, 4, 3))
    const dim = daysInUtcMonth(run)
    let sum = 0
    for (let d = 1; d <= dim; d++) {
      sum += sliceMonthlyAmountForDailyRun(3100, new Date(Date.UTC(2026, 4, d)))
    }
    expect(sum).toBeCloseTo(3100, 5)
  })

  it("fundingPeriodKeyForDate handles monthly bimonthly daily gate", () => {
    const run = new Date(Date.UTC(2026, 4, 10))
    expect(fundingPeriodKeyForDate({ payCadence: "monthly", runDateUtc: run, dailyCadenceAllowed: true })).toBe(
      "2026-05",
    )
    expect(fundingPeriodKeyForDate({ payCadence: "bimonthly", runDateUtc: run, dailyCadenceAllowed: true })).toBe(
      "2026-05-a",
    )
    expect(fundingPeriodKeyForDate({ payCadence: "bimonthly", runDateUtc: new Date(Date.UTC(2026, 4, 18)), dailyCadenceAllowed: true })).toBe(
      "2026-05-b",
    )
    expect(fundingPeriodKeyForDate({ payCadence: "daily", runDateUtc: run, dailyCadenceAllowed: false })).toBeNull()
    expect(fundingPeriodKeyForDate({ payCadence: "daily", runDateUtc: run, dailyCadenceAllowed: true })).toBe(
      "2026-05-10",
    )
  })

  it("grossIncomeForFundingRun returns 0 when daily disallowed", () => {
    const run = new Date(Date.UTC(2026, 0, 15))
    expect(grossIncomeForFundingRun(3000, "daily", run, false)).toBe(0)
    expect(allotmentSliceForFundingRun(500, "daily", run, false)).toBe(0)
  })

  it("bimonthly gross is half of monthly income", () => {
    const run = new Date(Date.UTC(2026, 2, 5))
    expect(grossIncomeForFundingRun(4000, "bimonthly", run, false)).toBe(2000)
  })

  it("bimonthly slices partition odd cents across halves without monthly drift", () => {
    const first = new Date(Date.UTC(2026, 2, 10))
    const second = new Date(Date.UTC(2026, 2, 20))
    const a = sliceMonthlyAmountForBimonthlyRun(100.01, first)
    const b = sliceMonthlyAmountForBimonthlyRun(100.01, second)
    expect(a + b).toBeCloseTo(100.01, 5)
    expect(a).toBe(50)
    expect(b).toBeCloseTo(50.01, 5)
  })
})
