// @vitest-environment node
import { describe, expect, it } from "vitest"
import { computeIrregularIncomeSplits, sumAllocatedIrregularCents } from "../irregular-income-split"

describe("irregular-income-split", () => {
  it("returns empty when gross invalid", () => {
    const r = computeIrregularIncomeSplits({
      grossUsd: -10,
      monthlyIncome: 4000,
      envelopes: [{ id: "a", monthlyAllotment: 100 }],
    })
    expect(r.envelopeIdToCents.size).toBe(0)
  })

  it("returns empty when monthly income invalid", () => {
    const r = computeIrregularIncomeSplits({
      grossUsd: 500,
      monthlyIncome: 0,
      envelopes: [{ id: "a", monthlyAllotment: 100 }],
    })
    expect(r.envelopeIdToCents.size).toBe(0)
  })

  it("excludes envelope ids from split", () => {
    const r = computeIrregularIncomeSplits({
      grossUsd: 100,
      monthlyIncome: 100,
      envelopes: [
        { id: "save", monthlyAllotment: 50 },
        { id: "food", monthlyAllotment: 50 },
      ],
      excludeEnvelopeIds: new Set(["save"]),
    })
    expect(sumAllocatedIrregularCents(r)).toBe(5000)
    expect(r.envelopeIdToCents.get("save")).toBeUndefined()
    expect(r.envelopeIdToCents.get("food")).toBe(5000)
  })

  it("allocates proportional cents that sum to gross", () => {
    const r = computeIrregularIncomeSplits({
      grossUsd: 33.33,
      monthlyIncome: 100,
      envelopes: [
        { id: "a", monthlyAllotment: 60 },
        { id: "b", monthlyAllotment: 40 },
      ],
    })
    expect(sumAllocatedIrregularCents(r)).toBe(3333)
    expect((r.envelopeIdToCents.get("a") ?? 0) + (r.envelopeIdToCents.get("b") ?? 0)).toBe(3333)
  })
})
