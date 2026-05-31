// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  computeDistribution,
  deltaForBehavior,
  validateExplicitAllocations,
} from "../move-funds-math"

describe("move-funds-math", () => {
  it("deltaForBehavior set_to_budget uses gap", () => {
    expect(deltaForBehavior("set_to_budget", 100, 40)).toBe(60)
    expect(deltaForBehavior("add_budget", 100, 40)).toBe(100)
    expect(deltaForBehavior("custom", 100, 40, 25)).toBe(25)
  })

  it("computeDistribution uses income then savings when flagged", () => {
    const result = computeDistribution({
      behavior: "set_to_budget",
      envelopes: [
        { id: "a", monthlyAllotment: 100, currentMonthBalance: 0 },
        { id: "b", monthlyAllotment: 50, currentMonthBalance: 0 },
      ],
      grossUsd: 80,
      savingsBalance: 100,
      fundOverageFromSavings: true,
    })
    expect(result.invalid).toBe(false)
    expect(result.totalNeed).toBe(150)
    expect(result.fromIncome).toBe(80)
    expect(result.fromSavings).toBe(70)
  })

  it("computeDistribution invalid when shortfall and no savings funding", () => {
    const result = computeDistribution({
      behavior: "add_budget",
      envelopes: [{ id: "a", monthlyAllotment: 100, currentMonthBalance: 0 }],
      grossUsd: 50,
      savingsBalance: 200,
      fundOverageFromSavings: false,
    })
    expect(result.invalid).toBe(true)
  })

  it("validateExplicitAllocations", () => {
    expect(validateExplicitAllocations(100, [{ amountUsd: 60 }, { amountUsd: 40 }])).toBe(true)
    expect(validateExplicitAllocations(100, [{ amountUsd: 101 }])).toBe(false)
  })
})
