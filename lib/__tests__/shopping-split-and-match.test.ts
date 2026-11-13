// @vitest-environment node
import { describe, expect, it } from "vitest"
import { dollarsToCents, splitCentsByWeights, allocateReceiptCents } from "../shopping-split-math"
import { parseItemizedModelOutput } from "../shopping-receipt"
import {
  allocateLineQuantities,
  suggestMatchesForLine,
  unitsCompatible,
} from "../shopping-item-matcher"

describe("shopping-split-math", () => {
  it("parses dollars to integer cents", () => {
    expect(dollarsToCents("10.00")).toBe(1000)
    expect(dollarsToCents("0.1")).toBe(10)
    expect(dollarsToCents(1.15)).toBe(115)
  })

  it("splits 1:2:3 shares with remainder on stable ids", () => {
    const split = splitCentsByWeights(100, [
      { id: "a", weight: 1 },
      { id: "b", weight: 2 },
      { id: "c", weight: 3 },
    ])
    expect(split.reduce((s, r) => s + r.cents, 0)).toBe(100)
    expect(split.map((s) => s.cents)).toEqual([17, 33, 50])
  })

  it("allocates tax and fees so member shares equal the total", () => {
    const totals = allocateReceiptCents({
      lines: [
        {
          lineId: "l1",
          netCents: 4000,
          assignments: [{ requestId: "rA", memberId: "A", quantity: 1 }],
        },
        {
          lineId: "l2",
          netCents: 6000,
          assignments: [{ requestId: "rB", memberId: "B", quantity: 1 }],
        },
      ],
      charges: { taxCents: 0, discountCents: 0, feeCents: 0 },
      totalCents: 10000,
    })
    expect(totals.find((t) => t.memberId === "A")?.totalCents).toBe(4000)
    expect(totals.find((t) => t.memberId === "B")?.totalCents).toBe(6000)
    expect(totals.reduce((s, t) => s + t.totalCents, 0)).toBe(10000)
  })
})

describe("shopping-item-matcher", () => {
  it("matches abbreviations and preserves touched rows", () => {
    expect(unitsCompatible("lb", "pound")).toBe(true)
    expect(unitsCompatible("each", "pound")).toBe(false)
    const hits = suggestMatchesForLine(
      { id: "line1", description: "org whole milk", quantity: 1, unit: "each" },
      [
        { id: "req1", memberId: "A", description: "organic milk", requestedQuantity: 1, purchasedQuantity: 0, unit: "each" },
        { id: "req2", memberId: "B", description: "apples", requestedQuantity: 2, purchasedQuantity: 0, unit: "each" },
      ],
    )
    expect(hits[0]?.requestId).toBe("req1")
    const allocated = allocateLineQuantities({
      lineQuantity: 2,
      rankedRequestIds: ["req1", "req2"],
      remainingByRequest: new Map([["req1", 1], ["req2", 2]]),
      touchedRequestIds: new Set(["req1"]),
    })
    expect(allocated.get("req1")).toBeUndefined()
    expect(allocated.get("req2")).toBe(2)
  })
})

describe("itemized receipt validation", () => {
  it("rejects unsupported currency and truncated output", () => {
    const result = parseItemizedModelOutput({
      merchant: "Shop",
      date: "2026-09-01",
      currency: "EUR",
      total: "10.00",
      truncated: true,
      lines: [{ description: "x", quantity: 1, amount: "10.00" }],
    })
    expect(result.issues).toContain("unsupported_currency")
    expect(result.issues).toContain("truncated")
  })
})
