import { describe, expect, it } from "vitest"
import { monthlyBudgetForAllocation } from "../onboarding-allocate-budget"

describe("monthlyBudgetForAllocation", () => {
  it("passes through monthly pay", () => {
    expect(monthlyBudgetForAllocation(5000, "monthly")).toBe(5000)
  })

  it("doubles bi-monthly per-paycheck amount for monthly envelope budget", () => {
    expect(monthlyBudgetForAllocation(2500, "bimonthly")).toBe(5000)
  })

  it("returns 0 for non-positive or NaN", () => {
    expect(monthlyBudgetForAllocation(0, "monthly")).toBe(0)
    expect(monthlyBudgetForAllocation(-1, "bimonthly")).toBe(0)
    expect(monthlyBudgetForAllocation(NaN, "monthly")).toBe(0)
  })
})
