import { describe, expect, it } from "vitest"
import { transactionPostAgainPrefill } from "@/lib/transaction-post-again-prefill"
import type { Transaction } from "@/lib/data"

const base: Pick<
  Transaction,
  "payee" | "amount" | "type" | "envelopeId" | "tags" | "notes" | "isDecrypted" | "source"
> = {
  payee: "Coffee Shop",
  amount: 4.5,
  type: "expense",
  envelopeId: "env-1",
  tags: ["food"],
  notes: "latte",
  isDecrypted: true,
  source: "manual",
}

describe("transactionPostAgainPrefill", () => {
  it("clones fields with today's local calendar date", () => {
    const now = new Date(2026, 4, 14, 12, 0, 0)
    expect(transactionPostAgainPrefill(base, now)).toEqual({
      payee: "Coffee Shop",
      amount: "4.5",
      type: "expense",
      envelopeId: "env-1",
      tags: ["food"],
      notes: "latte",
      date: "2026-05-14",
    })
  })

  it("returns null for encrypted or funding-leg rows", () => {
    expect(transactionPostAgainPrefill({ ...base, isDecrypted: false }, new Date())).toBeNull()
    expect(
      transactionPostAgainPrefill({ ...base, source: "envelope_funding_out" }, new Date()),
    ).toBeNull()
  })
})
