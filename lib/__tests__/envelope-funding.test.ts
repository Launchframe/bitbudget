// @vitest-environment node
import { describe, expect, it } from "vitest"
import { isBudgetAllocationDay } from "../budget-period"
import { allocationTopUpAmount } from "../budget-period"
import { computeDistribution } from "../rebalance-math"

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

describe("irregular income set_to_budget: all-time vs month balance for carry-forward envelopes", () => {
  /**
   * Scenario: carry-forward envelope with $80 carryover from January.
   * User spent $40 in February before recording bonus income (no Feb allocation yet).
   *
   * - Month balance = -$40  (Feb spending: $0 credit - $40 expense)
   * - All-time balance = $40  (Jan carryover $80 - Feb spending $40)
   * - Allotment = $200
   *
   * Correct gap (all-time): $200 - $40 = $160
   * Buggy gap   (month):    $200 - (-$40) = $240  → over-allocates by $80
   */
  const envelope = { id: "env1", monthlyAllotment: 200 }
  const grossUsd = 500

  it("RED: month balance overstates gap for carry-forward envelope", () => {
    const monthBalance = -40 // only current-month activity, carryover excluded
    const dist = computeDistribution({
      behavior: "set_to_budget",
      envelopes: [{ ...envelope, currentMonthBalance: monthBalance }],
      grossUsd,
      savingsBalance: 1000,
      fundOverageFromSavings: false,
    })
    // With month balance, set_to_budget computes gap = 200 - (-40) = 240 — over-allocation
    expect(dist.invalid).toBe(false)
    const line = dist.lines.find((l) => l.envelopeId === "env1")
    expect(line?.deltaUsd).toBe(240)
  })

  it("GREEN: all-time balance gives the correct gap for carry-forward envelope", () => {
    const allTimeBalance = 40 // includes prior-month carryover
    const dist = computeDistribution({
      behavior: "set_to_budget",
      envelopes: [{ ...envelope, currentMonthBalance: allTimeBalance }],
      grossUsd,
      savingsBalance: 1000,
      fundOverageFromSavings: false,
    })
    // With all-time balance, set_to_budget computes gap = 200 - 40 = 160 — correct
    expect(dist.invalid).toBe(false)
    const line = dist.lines.find((l) => l.envelopeId === "env1")
    expect(line?.deltaUsd).toBe(160)
  })

  it("GREEN: envelope already above allotment (all-time) → zero allocation", () => {
    const allTimeBalance = 220 // more than allotment, no top-up needed
    const dist = computeDistribution({
      behavior: "set_to_budget",
      envelopes: [{ ...envelope, currentMonthBalance: allTimeBalance }],
      grossUsd,
      savingsBalance: 1000,
      fundOverageFromSavings: false,
    })
    // All-time balance >= allotment → no lines should be generated
    expect(dist.lines.length).toBe(0)
  })
})
