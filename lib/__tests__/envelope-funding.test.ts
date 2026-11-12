// @vitest-environment node
import { describe, expect, it } from "vitest"
import { isBudgetAllocationDay } from "../budget-period"
import { allocationTopUpAmount } from "../budget-period"

describe("envelope-funding helpers", () => {
  it("isBudgetAllocationDay is true on UTC 1st", () => {
    expect(isBudgetAllocationDay(new Date(Date.UTC(2026, 4, 1, 15, 0, 0)))).toBe(true)
    expect(isBudgetAllocationDay(new Date(Date.UTC(2026, 4, 2, 0, 0, 0)))).toBe(false)
  })

  it("allocationTopUpAmount fills gap to monthly allotment", () => {
    expect(allocationTopUpAmount({ monthlyAllotment: 100, currentMonthBalance: 40 })).toBe(60)
    expect(allocationTopUpAmount({ monthlyAllotment: 100, currentMonthBalance: 100 })).toBe(0)
  })
})
