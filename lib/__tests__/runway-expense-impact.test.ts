import { describe, expect, it } from "vitest"
import {
  computeGoalImpact,
  computeMonthsLeftImpact,
  formatMonthsLeft,
  isLargeExpense,
} from "../runway-expense-impact"

describe("computeGoalImpact", () => {
  it("returns none when there is no goal", () => {
    expect(computeGoalImpact({ goalUsd: 0, keptSoFarUsd: 100, incomeStillExpectedUsd: 500 }).status).toBe(
      "none",
    )
    expect(
      computeGoalImpact({ goalUsd: NaN, keptSoFarUsd: 100, incomeStillExpectedUsd: 500 }).status,
    ).toBe("none")
  })

  it("flags out of reach when goal cannot be met even spending nothing else", () => {
    // goal 1000, kept 200, income still expected 400 → max achievable 600, short 400.
    const r = computeGoalImpact({
      goalUsd: 1000,
      keptSoFarUsd: 200,
      incomeStillExpectedUsd: 400,
    })
    expect(r.status).toBe("out_of_reach")
    expect(r.outOfReachByUsd).toBe(400)
    expect(r.achievableUsd).toBe(600)
  })

  it("adds a considered expense to the shortfall", () => {
    // Without expense: kept 300 + income 800 = 1100 ≥ goal 1000 → reachable.
    // With a 280 expense: achievable 820, short 180.
    const base = computeGoalImpact({
      goalUsd: 1000,
      keptSoFarUsd: 300,
      incomeStillExpectedUsd: 800,
    })
    expect(base.status).not.toBe("out_of_reach")

    const withExpense = computeGoalImpact({
      goalUsd: 1000,
      keptSoFarUsd: 300,
      incomeStillExpectedUsd: 800,
      expenseUsd: 280,
    })
    expect(withExpense.status).toBe("out_of_reach")
    expect(withExpense.outOfReachByUsd).toBe(180)
  })

  it("flags behind pace when reachable but below straight-line pace with income still coming", () => {
    // Half the month gone, goal 1000 → pace target 500. Kept 100, income 2000
    // (reachable). 100 < 500 → behind by 400.
    const r = computeGoalImpact({
      goalUsd: 1000,
      keptSoFarUsd: 100,
      incomeStillExpectedUsd: 2000,
      monthProgress: 0.5,
    })
    expect(r.status).toBe("behind_pace")
    expect(r.behindPaceByUsd).toBe(400)
  })

  it("does not flag behind pace without month progress", () => {
    const r = computeGoalImpact({
      goalUsd: 1000,
      keptSoFarUsd: 100,
      incomeStillExpectedUsd: 2000,
    })
    expect(r.status).toBe("none")
  })

  it("does not flag behind pace when no more income is expected (cannot catch up)", () => {
    // Reachable only because kept already ≥ goal; no income left → not behind pace.
    const r = computeGoalImpact({
      goalUsd: 1000,
      keptSoFarUsd: 1000,
      incomeStillExpectedUsd: 0,
      monthProgress: 0.5,
    })
    expect(r.status).toBe("none")
  })

  it("out of reach takes priority over behind pace", () => {
    const r = computeGoalImpact({
      goalUsd: 1000,
      keptSoFarUsd: 0,
      incomeStillExpectedUsd: 100,
      monthProgress: 0.9,
    })
    expect(r.status).toBe("out_of_reach")
    expect(r.outOfReachByUsd).toBe(900)
  })

  it("stays reachable (none) when on or ahead of pace", () => {
    const r = computeGoalImpact({
      goalUsd: 1000,
      keptSoFarUsd: 600,
      incomeStillExpectedUsd: 1000,
      monthProgress: 0.5,
    })
    expect(r.status).toBe("none")
  })
})

describe("computeMonthsLeftImpact", () => {
  it("is unavailable when there is no monthly draw", () => {
    const r = computeMonthsLeftImpact({
      liquidTodayUsd: 10000,
      monthlyDrawUsd: 0,
      expenseUsd: 500,
    })
    expect(r.available).toBe(false)
    expect(r.deltaMonths).toBeNull()
  })

  it("computes months before/after and the delta at spot", () => {
    // 12,000 liquid, draw 2,000/mo → 6 months. A 2,000 expense → 5 months.
    const r = computeMonthsLeftImpact({
      liquidTodayUsd: 12000,
      monthlyDrawUsd: 2000,
      expenseUsd: 2000,
    })
    expect(r.available).toBe(true)
    expect(r.monthsBefore).toBe(6)
    expect(r.monthsAfter).toBe(5)
    expect(r.deltaMonths).toBe(1)
  })

  it("floors months-after at zero when the expense exceeds liquid", () => {
    const r = computeMonthsLeftImpact({
      liquidTodayUsd: 1000,
      monthlyDrawUsd: 2000,
      expenseUsd: 5000,
    })
    expect(r.monthsAfter).toBe(0)
    expect(r.deltaMonths).toBe(0.5)
  })

  it("passes through optional stress and growth marks", () => {
    const r = computeMonthsLeftImpact({
      liquidTodayUsd: 12000,
      monthlyDrawUsd: 2000,
      expenseUsd: 2000,
      liquidStressUsd: 8000,
      liquidGrowthUsd: 16000,
    })
    expect(r.monthsBeforeStress).toBe(4)
    expect(r.monthsAfterStress).toBe(3)
    expect(r.monthsBeforeGrowth).toBe(8)
    expect(r.monthsAfterGrowth).toBe(7)
  })

  it("leaves optional marks null when not provided or not finite", () => {
    const r = computeMonthsLeftImpact({
      liquidTodayUsd: 12000,
      monthlyDrawUsd: 2000,
      expenseUsd: 2000,
      liquidStressUsd: null,
      liquidGrowthUsd: Infinity,
    })
    expect(r.monthsBeforeStress).toBeNull()
    expect(r.monthsBeforeGrowth).toBeNull()
  })
})

describe("isLargeExpense", () => {
  it("is false without a positive usual figure or expense", () => {
    expect(isLargeExpense(500, 0)).toBe(false)
    expect(isLargeExpense(0, 200)).toBe(false)
    expect(isLargeExpense(NaN, 200)).toBe(false)
  })

  it("is true once the expense is a multiple of the usual monthly spend", () => {
    expect(isLargeExpense(300, 200)).toBe(true) // 300 ≥ 200 * 1.5
    expect(isLargeExpense(299, 200)).toBe(false)
    expect(isLargeExpense(500, 200, 2)).toBe(true) // 500 ≥ 200 * 2
    expect(isLargeExpense(399, 200, 2)).toBe(false)
  })
})

describe("formatMonthsLeft", () => {
  it("handles null, tiny, and whole-month values", () => {
    expect(formatMonthsLeft(null)).toBe("—")
    expect(formatMonthsLeft(-1)).toBe("—")
    expect(formatMonthsLeft(0.2)).toBe("under a month")
    expect(formatMonthsLeft(1)).toBe("about 1 month")
    expect(formatMonthsLeft(5.4)).toBe("about 5 months")
    expect(formatMonthsLeft(5.6)).toBe("about 6 months")
  })
})
