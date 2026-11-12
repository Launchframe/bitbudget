import { describe, expect, it } from "vitest"
import type { Transaction } from "@/lib/data"
import { PRIVATE_TAG_NAME } from "@/lib/constants"
import {
  filterAnalyticsExpenses,
  filterUserFacingExpenses,
  isAnalyticsExpense,
  isUserFacingExpense,
  todayUtcIso,
  txnIsoDate,
} from "../transaction-visibility"

function txn(partial: Partial<Transaction> & Pick<Transaction, "type">): Transaction {
  return {
    id: "t1",
    payee: "Test",
    amount: 10,
    date: "2024-01-01",
    envelopeId: "env-1",
    tags: [],
    ...partial,
  }
}

describe("transaction-visibility", () => {
  it("isUserFacingExpense rejects hidden funding legs", () => {
    expect(isUserFacingExpense(txn({ type: "expense" }))).toBe(true)
    expect(
      isUserFacingExpense(
        txn({ type: "expense", excludeFromMainHistory: true, source: "envelope_funding_out" }),
      ),
    ).toBe(false)
  })

  it("isUserFacingExpense rejects move-funds and deficit-cover transfer expenses", () => {
    expect(
      isUserFacingExpense(
        txn({ type: "expense", source: "envelope_transfer_out" }),
      ),
    ).toBe(false)
    expect(
      isUserFacingExpense(
        txn({ type: "expense", source: "deficit_cover" }),
      ),
    ).toBe(false)
  })

  it("filterUserFacingExpenses keeps only visible expenses", () => {
    const rows = [
      txn({ id: "a", type: "expense" }),
      txn({ id: "b", type: "expense", excludeFromMainHistory: true }),
      txn({ id: "c", type: "credit" }),
    ]
    expect(filterUserFacingExpenses(rows).map((t) => t.id)).toEqual(["a"])
  })

  it("isAnalyticsExpense excludes private-tagged user-facing expenses", () => {
    expect(isAnalyticsExpense(txn({ type: "expense" }))).toBe(true)
    expect(
      isAnalyticsExpense(txn({ type: "expense", tags: [PRIVATE_TAG_NAME] })),
    ).toBe(false)
    expect(
      isAnalyticsExpense(
        txn({ type: "expense", excludeFromMainHistory: true, tags: [PRIVATE_TAG_NAME] }),
      ),
    ).toBe(false)
  })

  it("filterAnalyticsExpenses keeps only analytics-eligible expenses", () => {
    const rows = [
      txn({ id: "a", type: "expense" }),
      txn({ id: "b", type: "expense", tags: [PRIVATE_TAG_NAME] }),
      txn({ id: "c", type: "expense", excludeFromMainHistory: true }),
      txn({ id: "d", type: "credit" }),
    ]
    expect(filterAnalyticsExpenses(rows).map((t) => t.id)).toEqual(["a"])
  })

  it("todayUtcIso and txnIsoDate normalize calendar days", () => {
    expect(txnIsoDate("2024-03-15T12:00:00.000Z")).toBe("2024-03-15")
    expect(todayUtcIso(new Date("2024-06-01T23:00:00.000Z"))).toBe("2024-06-01")
  })
})
