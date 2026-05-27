import { describe, expect, it } from "vitest"
import type { Transaction } from "@/lib/data"
import {
  filterUserFacingExpenses,
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

  it("filterUserFacingExpenses keeps only visible expenses", () => {
    const rows = [
      txn({ id: "a", type: "expense" }),
      txn({ id: "b", type: "expense", excludeFromMainHistory: true }),
      txn({ id: "c", type: "credit" }),
    ]
    expect(filterUserFacingExpenses(rows).map((t) => t.id)).toEqual(["a"])
  })

  it("todayUtcIso and txnIsoDate normalize calendar days", () => {
    expect(txnIsoDate("2024-03-15T12:00:00.000Z")).toBe("2024-03-15")
    expect(todayUtcIso(new Date("2024-06-01T23:00:00.000Z"))).toBe("2024-06-01")
  })
})
