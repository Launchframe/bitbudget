import { describe, expect, it } from "vitest"
import {
  findCollidingTransaction,
  normalizeDedupAmount,
  transactionCollisionKey,
} from "@/lib/transaction-dedup"
import type { Transaction } from "@/lib/data"

const baseTxn = (over: Partial<Transaction>): Transaction => ({
  id: "x",
  date: "2026-04-26",
  payee: "Coffee Shop",
  amount: 12.5,
  type: "expense",
  envelopeId: "e1",
  tags: [],
  ...over,
})

describe("normalizeDedupAmount", () => {
  it("rounds to cents", () => {
    expect(normalizeDedupAmount(10)).toBe(10)
    expect(normalizeDedupAmount(10.001)).toBe(10)
    expect(normalizeDedupAmount(10.009)).toBe(10.01)
  })
})

describe("transactionCollisionKey", () => {
  it("includes type so expense ≠ credit", () => {
    const e = transactionCollisionKey({
      date: "2026-04-26",
      payee: "Refund",
      amount: 25,
      type: "expense",
    })
    const c = transactionCollisionKey({
      date: "2026-04-26",
      payee: "Refund",
      amount: 25,
      type: "credit",
    })
    expect(e).not.toBe(c)
  })

  it("normalizes payee casing", () => {
    expect(
      transactionCollisionKey({
        date: "2026-04-26",
        payee: "  Foo Bar ",
        amount: 1,
        type: "expense",
      }),
    ).toBe(
      transactionCollisionKey({
        date: "2026-04-26",
        payee: "foo bar",
        amount: 1,
        type: "expense",
      }),
    )
  })
})

describe("findCollidingTransaction", () => {
  it("returns matching row", () => {
    const rows = [baseTxn({ id: "a" })]
    const hit = findCollidingTransaction(rows, {
      date: "2026-04-26",
      payee: "coffee shop",
      amount: 12.5,
      type: "expense",
    })
    expect(hit?.id).toBe("a")
  })

  it("returns undefined when payee differs", () => {
    const rows = [baseTxn({})]
    expect(
      findCollidingTransaction(rows, {
        date: "2026-04-26",
        payee: "Tea Shop",
        amount: 12.5,
        type: "expense",
      }),
    ).toBeUndefined()
  })
})
