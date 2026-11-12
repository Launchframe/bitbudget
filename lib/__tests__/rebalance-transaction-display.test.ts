// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { Transaction } from "@/lib/data"
import {
  TX_SOURCE_ENVELOPE_TRANSFER_IN,
  TX_SOURCE_ENVELOPE_TRANSFER_OUT,
} from "@/lib/constants"
import {
  collapseRebalanceBatches,
  isRebalanceGroupRow,
} from "@/lib/rebalance-transaction-display"

function leg(
  partial: Partial<Transaction> & Pick<Transaction, "id" | "envelopeId" | "source">,
): Transaction {
  return {
    date: "2026-06-01",
    payee: "Transfer",
    amount: 100,
    type: partial.source === TX_SOURCE_ENVELOPE_TRANSFER_IN ? "credit" : "expense",
    tags: [],
    fundingBatchId: "batch-1",
    fundingBatchKind: "rebalance",
    ...partial,
  }
}

describe("collapseRebalanceBatches", () => {
  it("shows zero Savings delta for balanced envelope-to-envelope rebalances", () => {
    const rows = collapseRebalanceBatches(
      [
        leg({
          id: "a-out",
          envelopeId: "env-a",
          source: TX_SOURCE_ENVELOPE_TRANSFER_OUT,
          amount: 25,
        }),
        leg({
          id: "b-in",
          envelopeId: "env-b",
          source: TX_SOURCE_ENVELOPE_TRANSFER_IN,
          amount: 25,
        }),
      ],
      "sav-1",
    )
    expect(rows).toHaveLength(1)
    expect(isRebalanceGroupRow(rows[0]!)).toBe(true)
    if (isRebalanceGroupRow(rows[0]!)) {
      expect(rows[0].savingsDeltaUsd).toBe(0)
      expect(rows[0].envelopeCount).toBe(2)
    }
  })

  it("nets Savings movement for independent fund-from-Savings rebalances", () => {
    const rows = collapseRebalanceBatches(
      [
        leg({
          id: "sav-out",
          envelopeId: "sav-1",
          source: TX_SOURCE_ENVELOPE_TRANSFER_OUT,
          amount: 100,
        }),
        leg({
          id: "gro-in",
          envelopeId: "env-gro",
          source: TX_SOURCE_ENVELOPE_TRANSFER_IN,
          amount: 100,
        }),
      ],
      "sav-1",
    )
    expect(isRebalanceGroupRow(rows[0]!)).toBe(true)
    if (isRebalanceGroupRow(rows[0]!)) {
      expect(rows[0].savingsDeltaUsd).toBe(-100)
    }
  })

  it("nets Savings credits when money moves back to Savings", () => {
    const rows = collapseRebalanceBatches(
      [
        leg({
          id: "gro-out",
          envelopeId: "env-gro",
          source: TX_SOURCE_ENVELOPE_TRANSFER_OUT,
          amount: 40,
        }),
        leg({
          id: "sav-in",
          envelopeId: "sav-1",
          source: TX_SOURCE_ENVELOPE_TRANSFER_IN,
          amount: 40,
        }),
      ],
      "sav-1",
    )
    expect(isRebalanceGroupRow(rows[0]!)).toBe(true)
    if (isRebalanceGroupRow(rows[0]!)) {
      expect(rows[0].savingsDeltaUsd).toBe(40)
    }
  })
})
