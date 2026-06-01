// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  computeDistribution,
  deltaForBehavior,
  fundablePreviewRows,
  fundedAmountByEnvelopeId,
  validateExplicitAllocations,
  applyBalancedSliderChange,
  clampRebalanceDeltas,
} from "../rebalance-math"

describe("rebalance-math", () => {
  it("deltaForBehavior set_to_budget uses gap", () => {
    expect(deltaForBehavior("set_to_budget", 100, 40)).toBe(60)
    expect(deltaForBehavior("add_budget", 100, 40)).toBe(100)
    expect(deltaForBehavior("custom", 100, 40, 25)).toBe(25)
  })

  it("deltaForBehavior returns 0 for degenerate inputs", () => {
    // set_to_budget with balance already at/above allotment
    expect(deltaForBehavior("set_to_budget", 100, 100)).toBe(0)
    expect(deltaForBehavior("set_to_budget", 100, 150)).toBe(0)
    // add_budget with zero or negative allotment
    expect(deltaForBehavior("add_budget", 0, 0)).toBe(0)
    expect(deltaForBehavior("add_budget", -10, 0)).toBe(0)
    // custom with zero or missing amount
    expect(deltaForBehavior("custom", 100, 0, 0)).toBe(0)
    expect(deltaForBehavior("custom", 100, 0, undefined)).toBe(0)
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
    expect(result.invalidReason).toBe("insufficient_income")
  })

  it("computeDistribution invalid when shortfall exceeds savings", () => {
    const result = computeDistribution({
      behavior: "add_budget",
      envelopes: [{ id: "a", monthlyAllotment: 200, currentMonthBalance: 0 }],
      grossUsd: 50,
      savingsBalance: 10,
      fundOverageFromSavings: true,
    })
    expect(result.invalid).toBe(true)
    expect(result.invalidReason).toBe("insufficient_savings")
  })

  it("computeDistribution returns empty lines when no envelope needs top-up", () => {
    const result = computeDistribution({
      behavior: "set_to_budget",
      envelopes: [{ id: "a", monthlyAllotment: 100, currentMonthBalance: 120 }],
      grossUsd: 500,
      savingsBalance: 100,
      fundOverageFromSavings: false,
    })
    expect(result.invalid).toBe(false)
    expect(result.lines).toHaveLength(0)
    expect(result.totalNeed).toBe(0)
  })

  it("computeDistribution returns invalid when grossUsd is zero", () => {
    const result = computeDistribution({
      behavior: "set_to_budget",
      envelopes: [{ id: "a", monthlyAllotment: 100, currentMonthBalance: 0 }],
      grossUsd: 0,
      savingsBalance: 200,
      fundOverageFromSavings: true,
    })
    expect(result.invalid).toBe(true)
    expect(result.invalidReason).toBe("no_income")
  })

  it("computeDistribution uses customByEnvelopeId for custom behavior", () => {
    const result = computeDistribution({
      behavior: "custom",
      envelopes: [
        { id: "a", monthlyAllotment: 100, currentMonthBalance: 0 },
        { id: "b", monthlyAllotment: 100, currentMonthBalance: 0 },
      ],
      grossUsd: 500,
      savingsBalance: 200,
      fundOverageFromSavings: false,
      customByEnvelopeId: new Map([["a", 30], ["b", 70]]),
    })
    expect(result.invalid).toBe(false)
    expect(result.totalNeed).toBe(100)
    expect(result.lines.find((l) => l.envelopeId === "a")?.deltaUsd).toBe(30)
    expect(result.lines.find((l) => l.envelopeId === "b")?.deltaUsd).toBe(70)
  })

  it("validateExplicitAllocations", () => {
    expect(validateExplicitAllocations(100, [{ amountUsd: 60 }, { amountUsd: 40 }])).toBe(true)
    expect(validateExplicitAllocations(100, [{ amountUsd: 101 }])).toBe(false)
  })

  it("fundedAmountByEnvelopeId caps to affordable income when invalid", () => {
    const dist = computeDistribution({
      behavior: "add_budget",
      envelopes: [
        { id: "a", monthlyAllotment: 100, currentMonthBalance: 0 },
        { id: "b", monthlyAllotment: 100, currentMonthBalance: 0 },
      ],
      grossUsd: 50,
      savingsBalance: 0,
      fundOverageFromSavings: false,
    })
    expect(dist.invalid).toBe(true)
    const funded = fundedAmountByEnvelopeId(dist)
    const fundedSum = [...funded.values()].reduce((s, v) => s + v, 0)
    expect(fundedSum).toBeGreaterThan(0)
    expect(fundedSum).toBeLessThanOrEqual(50.02)
    expect(fundablePreviewRows(dist, "Add budget")).toHaveLength(0)
  })

  it("clampRebalanceDeltas zeros credits when Savings is empty and envelopes have no balance", () => {
    const clamped = clampRebalanceDeltas(
      { a: 500, b: 300 },
      [
        { id: "a", monthlyAllotment: 1000, currentBalance: 0 },
        { id: "b", monthlyAllotment: 800, currentBalance: 0 },
      ],
      { creditMultiplier: 10, savingsBalance: 0 },
    )
    expect(clamped).toEqual({})
  })

  it("clampRebalanceDeltas scales credits down to Savings balance", () => {
    const clamped = clampRebalanceDeltas(
      { a: 600, b: 400 },
      [
        { id: "a", monthlyAllotment: 1000, currentBalance: 0 },
        { id: "b", monthlyAllotment: 800, currentBalance: 0 },
      ],
      { creditMultiplier: 10, savingsBalance: 100 },
    )
    expect((clamped.a ?? 0) + (clamped.b ?? 0)).toBeCloseTo(100, 1)
  })

  it("clampRebalanceDeltas blocks debits beyond current balance", () => {
    const clamped = clampRebalanceDeltas(
      { a: -50 },
      [{ id: "a", monthlyAllotment: 100, currentBalance: 20 }],
      { creditMultiplier: 1, savingsBalance: 1000 },
    )
    expect(clamped.a).toBe(-20)
  })

  it("applyBalancedSliderChange keeps zero-sum across envelopes", () => {
    const limits = new Map([
      ["a", { maxDebit: 50, maxCredit: 100, currentBalance: 50 }],
      ["b", { maxDebit: 50, maxCredit: 100, currentBalance: 50 }],
      ["c", { maxDebit: 50, maxCredit: 100, currentBalance: 50 }],
    ])
    const next = applyBalancedSliderChange("a", 20, { a: 0, b: 0, c: 0 }, ["a", "b", "c"], limits)
    const sum = Object.values(next).reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(0, 1)
    expect(next.a).toBeCloseTo(20, 1)
  })
})
