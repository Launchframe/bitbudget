// @vitest-environment node
import { describe, expect, it } from "vitest"
import { applyRebalanceQuickSelect } from "../rebalance-quick-selects"

describe("rebalance-quick-selects", () => {
  const envelopes = [
    {
      id: "a",
      monthlyAllotment: 100,
      currentBalance: 150,
      sweepPolicy: "capped" as const,
      sweepCapMultiplier: 1.5,
    },
    {
      id: "b",
      monthlyAllotment: 80,
      currentBalance: 20,
      sweepPolicy: "reset" as const,
      sweepCapMultiplier: null,
    },
  ]

  it("zero_base debits full remaining balances", () => {
    const deltas = applyRebalanceQuickSelect("zero_base", envelopes, {
      userDefaultSweepPolicy: "reset",
      userDefaultCapMultiplier: 1.5,
    })
    expect(deltas.a).toBe(-150)
    expect(deltas.b).toBe(-20)
  })

  it("sweep_to_savings returns nothing when all envelopes are empty", () => {
    const empty = envelopes.map((e) => ({ ...e, currentBalance: 0 }))
    const deltas = applyRebalanceQuickSelect("sweep_to_savings", empty, {
      userDefaultSweepPolicy: "reset",
      userDefaultCapMultiplier: 1.5,
    })
    expect(Object.keys(deltas)).toHaveLength(0)
  })

  it("proportional_fill distributes pool by allotment share", () => {
    const deltas = applyRebalanceQuickSelect("proportional_fill", envelopes, {
      userDefaultSweepPolicy: "reset",
      userDefaultCapMultiplier: 1.5,
      poolUsd: 180,
    })
    expect(deltas.a! + deltas.b!).toBeCloseTo(180, 1)
  })
})
