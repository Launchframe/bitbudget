import { describe, expect, it } from "vitest"
import { planSharedReceiptShares, ReceiptPlanError, suggestShoppingRequestId } from "../shopping-receipt-plan"

const members = ["ann", "ben"]

describe("planSharedReceiptShares", () => {
  it("splits the whole receipt evenly when there are no items", () => {
    expect(planSharedReceiptShares({ totalCents: 301, memberIds: members, lines: [] })).toEqual([
      { memberId: "ann", cents: 151 },
      { memberId: "ben", cents: 150 },
    ])
  })

  it("gives a matched item to the person who asked and splits the rest", () => {
    const shares = planSharedReceiptShares({
      totalCents: 300,
      memberIds: members,
      lines: [{ cents: 100, memberIds: ["ann"] }],
    })
    expect(shares).toEqual([
      { memberId: "ann", cents: 200 },
      { memberId: "ben", cents: 100 },
    ])
    expect(shares.reduce((sum, row) => sum + row.cents, 0)).toBe(300)
  })

  it("rejects items that exceed the total", () => {
    expect(() =>
      planSharedReceiptShares({
        totalCents: 100,
        memberIds: members,
        lines: [{ cents: 101, memberIds: ["ben"] }],
      }),
    ).toThrow(ReceiptPlanError)
  })
})

describe("suggestShoppingRequestId", () => {
  const requests = [
    {
      id: "milk",
      memberId: "ann",
      description: "Organic milk",
      requestedQuantity: 1,
      purchasedQuantity: 0,
      unit: "",
    },
    {
      id: "done",
      memberId: "ben",
      description: "Organic milk",
      requestedQuantity: 1,
      purchasedQuantity: 1,
      unit: "",
    },
  ]

  it("suggests an open item with the same name", () => {
    expect(suggestShoppingRequestId("organic milk", requests)).toBe("milk")
  })

  it("returns nothing when the name does not match", () => {
    expect(suggestShoppingRequestId("bread", requests)).toBeNull()
  })
})
