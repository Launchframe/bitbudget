// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { Transaction } from "../data"
import {
  displayPayeeForTransaction,
  displayTypeLabelForTransaction,
  incomeTransactionForBatch,
  isEnvelopeFundingLeg,
  transactionMatchesTypeFilter,
} from "../ledger-funding-display"
import { transactionsForTransactionList } from "../data"

function txn(partial: Partial<Transaction> & Pick<Transaction, "id">): Transaction {
  return {
    date: "2026-05-23",
    payee: "Test",
    amount: 100,
    type: "credit",
    envelopeId: "env-a",
    tags: [],
    ...partial,
  }
}

describe("ledger-funding-display", () => {
  it("finds income header in a funding batch", () => {
    const batch = "batch-1"
    const rows = [
      txn({ id: "inc", envelopeId: "sav", source: "irregular_income", fundingBatchId: batch, payee: "Bonus" }),
      txn({ id: "leg", envelopeId: "rent", source: "envelope_funding_in", fundingBatchId: batch }),
    ]
    expect(incomeTransactionForBatch(rows, batch)?.id).toBe("inc")
  })

  it("labels funding-in legs with income source", () => {
    const batch = "batch-1"
    const rows = [
      txn({ id: "inc", envelopeId: "sav", source: "paycheck", fundingBatchId: batch, payee: "Income" }),
      txn({ id: "leg", envelopeId: "rent", source: "envelope_funding_in", fundingBatchId: batch }),
    ]
    expect(displayPayeeForTransaction(rows[1]!, rows)).toBe("From Income")
    expect(displayTypeLabelForTransaction(rows[1]!)).toBe("Income")
  })

  it("labels irregular funding-in with payer name", () => {
    const batch = "batch-1"
    const rows = [
      txn({ id: "inc", envelopeId: "sav", source: "irregular_income", fundingBatchId: batch, payee: "Freelance" }),
      txn({ id: "leg", envelopeId: "rent", source: "envelope_funding_in", fundingBatchId: batch }),
    ]
    expect(displayPayeeForTransaction(rows[1]!, rows)).toBe("From Income · Freelance")
  })

  it("does not derive funding leg labels when session is locked", () => {
    const batch = "batch-1"
    const rows = [
      txn({
        id: "inc",
        envelopeId: "sav",
        source: "paycheck",
        fundingBatchId: batch,
        payee: "(encrypted)",
        isDecrypted: false,
      }),
      txn({
        id: "leg",
        envelopeId: "rent",
        source: "envelope_funding_in",
        fundingBatchId: batch,
        payee: "(encrypted)",
        isDecrypted: false,
      }),
    ]
    expect(displayPayeeForTransaction(rows[1]!, rows)).toBe("(encrypted)")
  })

  it("detects funding legs", () => {
    expect(isEnvelopeFundingLeg({ source: "envelope_funding_in" })).toBe(true)
    expect(isEnvelopeFundingLeg({ source: "manual" })).toBe(false)
  })

  it("filters by display type including Income", () => {
    const income = txn({ id: "inc", source: "irregular_income" })
    const fundingIn = txn({ id: "in", source: "envelope_funding_in" })
    const manualCredit = txn({ id: "mc", source: "manual", type: "credit" })
    const expense = txn({ id: "ex", source: "manual", type: "expense" })

    expect(transactionMatchesTypeFilter(income, "income")).toBe(true)
    expect(transactionMatchesTypeFilter(fundingIn, "income")).toBe(true)
    expect(transactionMatchesTypeFilter(manualCredit, "income")).toBe(false)
    expect(transactionMatchesTypeFilter(manualCredit, "credit")).toBe(true)
    expect(transactionMatchesTypeFilter(expense, "expense")).toBe(true)
    expect(transactionMatchesTypeFilter(income, "credit")).toBe(false)
  })
})

describe("transactionsForTransactionList", () => {
  const rows = [
    txn({ id: "inc", envelopeId: "sav", source: "irregular_income", excludeFromMainHistory: false }),
    txn({
      id: "leg",
      envelopeId: "rent",
      source: "envelope_funding_in",
      excludeFromMainHistory: true,
      fundingBatchId: "b1",
    }),
    txn({ id: "manual", envelopeId: "rent", source: "manual", excludeFromMainHistory: false }),
  ]

  it("hides funding legs from global list", () => {
    expect(transactionsForTransactionList(rows).map((t) => t.id)).toEqual(["inc", "manual"])
  })

  it("includes funding legs when scoped to an envelope", () => {
    expect(transactionsForTransactionList(rows, new Set(["rent"])).map((t) => t.id)).toEqual(["leg", "manual"])
  })
})
