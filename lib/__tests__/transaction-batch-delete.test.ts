import { describe, expect, it } from "vitest"
import type { Transaction } from "@/lib/data"
import {
  canDeleteTransactionFromList,
  incomeBatchDeleteConfirmMessage,
  incomeBatchHasFundingLegs,
  shouldCascadeDeleteFundingBatch,
  shouldConfirmIncomeBatchDelete,
} from "../transaction-batch-delete"

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: "inc",
    payee: "Paycheck",
    amount: 3000,
    date: "2024-03-01",
    type: "credit",
    envelopeId: "sav",
    tags: [],
    source: "income_import",
    fundingBatchId: "batch-1",
    ...partial,
  }
}

describe("transaction-batch-delete", () => {
  it("shouldCascadeDeleteFundingBatch for income headers only", () => {
    expect(shouldCascadeDeleteFundingBatch(txn({}))).toBe(true)
    expect(shouldCascadeDeleteFundingBatch(txn({ type: "expense" }))).toBe(false)
    expect(shouldCascadeDeleteFundingBatch(txn({ fundingBatchId: null }))).toBe(false)
    expect(shouldCascadeDeleteFundingBatch(txn({ source: "manual" }))).toBe(false)
  })

  it("incomeBatchHasFundingLegs detects allocation rows", () => {
    const rows = [
      txn({ id: "inc" }),
      txn({
        id: "leg",
        type: "expense",
        source: "envelope_funding_out",
        excludeFromMainHistory: true,
      }),
    ]
    expect(incomeBatchHasFundingLegs("batch-1", "inc", rows)).toBe(true)
    expect(incomeBatchHasFundingLegs("batch-1", "inc", [txn({ id: "inc" })])).toBe(false)
  })

  it("shouldConfirmIncomeBatchDelete when legs exist", () => {
    const rows = [
      txn({ id: "inc" }),
      txn({
        id: "leg",
        type: "expense",
        source: "envelope_funding_out",
        excludeFromMainHistory: true,
      }),
    ]
    expect(shouldConfirmIncomeBatchDelete(txn({ id: "inc" }), rows)).toBe(true)
    expect(shouldConfirmIncomeBatchDelete(txn({ id: "inc" }), [txn({ id: "inc" })])).toBe(false)
  })

  it("incomeBatchDeleteConfirmMessage varies by source", () => {
    expect(incomeBatchDeleteConfirmMessage("income_import")).toMatch(/past income/)
    expect(incomeBatchDeleteConfirmMessage("irregular_income")).toMatch(/envelope funding/)
  })

  it("canDeleteTransactionFromList blocks funding legs", () => {
    expect(canDeleteTransactionFromList({ source: "manual" })).toBe(true)
    expect(canDeleteTransactionFromList({ source: "envelope_funding_in" })).toBe(false)
    expect(canDeleteTransactionFromList({ source: "envelope_funding_out" })).toBe(false)
  })
})
