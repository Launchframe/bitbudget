import { describe, expect, it } from "vitest"
import {
  assignmentForReceiptDescription,
  continueReceiptFinancialAttempt,
  isReceiptAlreadyFinalizedError,
  isReceiptSequenceConflictError,
  markReceiptFinancialAttemptFinalized,
  memberIdsForPlannedReceiptLine,
  planSharedReceiptShares,
  ReceiptPlanError,
  receiptRequestIdsToCheckOff,
  suggestShoppingRequestId,
} from "../shopping-receipt-plan"

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

  it("splits a shared item across members and divides the remainder evenly", () => {
    const shares = planSharedReceiptShares({
      totalCents: 300,
      memberIds: members,
      lines: [{ cents: 120, memberIds: members }],
    })
    expect(shares).toEqual([
      { memberId: "ann", cents: 150 },
      { memberId: "ben", cents: 150 },
    ])
    expect(shares.reduce((sum, row) => sum + row.cents, 0)).toBe(300)
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

describe("planSharedReceiptShares member weights", () => {
  it("does not give someone a larger share when they are listed twice on a line", () => {
    expect(
      planSharedReceiptShares({
        totalCents: 100,
        memberIds: ["ann", "ben"],
        lines: [{ cents: 100, memberIds: ["ann", "ben", "ann"] }],
      }),
    ).toEqual([
      { memberId: "ann", cents: 50 },
      { memberId: "ben", cents: 50 },
    ])
  })

  it("conserves cents when a personal item and a shared remainder both round", () => {
    const shares = planSharedReceiptShares({
      totalCents: 100,
      memberIds: ["ann", "ben", "cy"],
      lines: [
        { cents: 10, memberIds: ["ann"] },
        { cents: 10, memberIds: ["ann", "ben", "cy"] },
      ],
    })
    expect(shares).toEqual([
      { memberId: "ann", cents: 41 },
      { memberId: "ben", cents: 30 },
      { memberId: "cy", cents: 29 },
    ])
    expect(shares.reduce((sum, row) => sum + row.cents, 0)).toBe(100)
  })
})

describe("memberIdsForPlannedReceiptLine", () => {
  const requests = [
    { id: "milk", requesterMemberId: "ann" },
    { id: "left", requesterMemberId: "gone" },
  ]

  it("charges the person who asked", () => {
    expect(
      memberIdsForPlannedReceiptLine({
        requestId: "milk",
        activeMemberIds: ["ann", "ben"],
        requests,
      }),
    ).toEqual(["ann"])
  })

  it("splits an unmatched line across active members once each", () => {
    expect(
      memberIdsForPlannedReceiptLine({
        requestId: null,
        activeMemberIds: ["ann", "ben", "ann"],
        requests,
      }),
    ).toEqual(["ann", "ben"])
  })

  it("rejects a person who is no longer in the group", () => {
    expect(() =>
      memberIdsForPlannedReceiptLine({
        requestId: "left",
        activeMemberIds: ["ann", "ben"],
        requests,
      }),
    ).toThrow(ReceiptPlanError)
  })
})

describe("assignmentForReceiptDescription", () => {
  const requests = [
    {
      id: "milk",
      memberId: "ann",
      description: "Organic milk",
      requestedQuantity: 1,
      purchasedQuantity: 0,
      unit: "",
    },
  ]

  it("fills an untouched row from the list", () => {
    expect(
      assignmentForReceiptDescription({
        touched: false,
        requestId: "",
        description: "organic milk",
        requests,
      }),
    ).toBe("milk")
  })

  it("does not replace a choice the person already made", () => {
    expect(
      assignmentForReceiptDescription({
        touched: true,
        requestId: "",
        description: "organic milk",
        requests,
      }),
    ).toBe("")
  })
})

describe("receipt save attempt", () => {
  it("reuses the same receipt when a save is retried", () => {
    const first = continueReceiptFinancialAttempt(null, () => ({
      receiptId: "r1",
      operationId: "op1",
    }))
    const retry = continueReceiptFinancialAttempt(first.attempt, () => ({
      receiptId: "r2",
      operationId: "op2",
    }))
    expect(retry.writeFinancial).toBe(true)
    expect(retry.attempt.receiptId).toBe("r1")
    expect(retry.attempt.operationId).toBe("op1")
  })

  it("does not start another receipt after finalize", () => {
    const done = markReceiptFinancialAttemptFinalized({
      receiptId: "r1",
      operationId: "op1",
      finalized: false,
    })
    const again = continueReceiptFinancialAttempt(done, () => ({
      receiptId: "r2",
      operationId: "op2",
    }))
    expect(again.writeFinancial).toBe(false)
    expect(again.attempt.receiptId).toBe("r1")
  })

  it("marks purchased only the open items named on the receipt", () => {
    expect(
      receiptRequestIdsToCheckOff(
        [
          { requestId: "milk" },
          { requestId: "milk" },
          { requestId: null },
          { requestId: "bread" },
          { requestId: "gone" },
        ],
        [
          { id: "milk", checkedOff: false },
          { id: "bread", checkedOff: true },
          { id: "eggs", checkedOff: false },
        ],
      ),
    ).toEqual(["milk"])
  })

  it("recognizes a finalized receipt and a stale shared list", () => {
    expect(isReceiptAlreadyFinalizedError(new Error("This receipt is already finalized"))).toBe(true)
    expect(isReceiptAlreadyFinalizedError(new Error("Could not save"))).toBe(false)
    expect(
      isReceiptSequenceConflictError(
        new Error("The shared tab changed. Refresh and review before saving."),
      ),
    ).toBe(true)
    expect(isReceiptSequenceConflictError(new Error("Could not save"))).toBe(false)
  })
})
