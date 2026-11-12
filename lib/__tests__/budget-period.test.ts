// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  allocationBatchPeriodKey,
  allocationTopUpAmount,
  budgetPeriodKey,
  deficitCoverAmount,
  isBudgetAllocationDay,
  paycheckBatchPeriodKey,
  sweepBatchPeriodKey,
} from "../budget-period"

describe("budget-period", () => {
  it("isBudgetAllocationDay is true only on UTC 1st", () => {
    expect(isBudgetAllocationDay(new Date(Date.UTC(2026, 4, 1)))).toBe(true)
    expect(isBudgetAllocationDay(new Date(Date.UTC(2026, 4, 2)))).toBe(false)
  })

  it("budget and batch period keys", () => {
    const run = new Date(Date.UTC(2026, 0, 1))
    expect(budgetPeriodKey(run)).toBe("2026-01")
    expect(allocationBatchPeriodKey(run)).toBe("alloc-2026-01")
    expect(sweepBatchPeriodKey(run)).toBe("sweep-2026-01")
    expect(paycheckBatchPeriodKey(run)).toBe("pay-2026-01-01")
  })

  it("allocationTopUpAmount fills gap to monthly allotment", () => {
    expect(allocationTopUpAmount({ monthlyAllotment: 100, currentMonthBalance: 40 })).toBe(60)
    expect(allocationTopUpAmount({ monthlyAllotment: 100, currentMonthBalance: 100 })).toBe(0)
    expect(allocationTopUpAmount({ monthlyAllotment: 100, currentMonthBalance: 120 })).toBe(0)
    expect(allocationTopUpAmount({ monthlyAllotment: 0, currentMonthBalance: 0 })).toBe(0)
  })

  it("deficitCoverAmount covers negative month balance only", () => {
    expect(deficitCoverAmount(-25.5)).toBe(25.5)
    expect(deficitCoverAmount(0)).toBe(0)
    expect(deficitCoverAmount(10)).toBe(0)
  })
})
