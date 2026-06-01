import {
  TX_SOURCE_ENVELOPE_TRANSFER_IN,
  TX_SOURCE_ENVELOPE_TRANSFER_OUT,
} from "@/lib/constants"
import type { Transaction } from "@/lib/data"

export function isRebalanceTransferLeg(
  txn: Pick<Transaction, "source" | "fundingBatchKind">,
): boolean {
  const kind = txn.fundingBatchKind
  if (kind !== "rebalance" && kind !== "move_funds") return false
  return (
    txn.source === TX_SOURCE_ENVELOPE_TRANSFER_IN ||
    txn.source === TX_SOURCE_ENVELOPE_TRANSFER_OUT
  )
}

export type RebalanceGroupRow = {
  kind: "rebalance_group"
  id: string
  fundingBatchId: string
  date: string
  envelopeCount: number
  savingsDeltaUsd: number
}

export type TransactionListRow = Transaction | RebalanceGroupRow

export function isRebalanceGroupRow(row: TransactionListRow): row is RebalanceGroupRow {
  return (row as RebalanceGroupRow).kind === "rebalance_group"
}

/** Collapse rebalance transfer legs into one summary row per batch (newest-first list order preserved). */
export function collapseRebalanceBatches(transactions: readonly Transaction[]): TransactionListRow[] {
  const seenBatch = new Set<string>()
  const out: TransactionListRow[] = []

  for (const t of transactions) {
    const batchId = t.fundingBatchId
    if (batchId && isRebalanceTransferLeg(t)) {
      if (seenBatch.has(batchId)) continue
      seenBatch.add(batchId)
      const legs = transactions.filter(
        (x) => x.fundingBatchId === batchId && isRebalanceTransferLeg(x),
      )
      let savingsDeltaUsd = 0
      const envelopeIds = new Set<string>()
      for (const leg of legs) {
        envelopeIds.add(leg.envelopeId)
        if (leg.source === TX_SOURCE_ENVELOPE_TRANSFER_IN) {
          savingsDeltaUsd -= leg.amount
        } else {
          savingsDeltaUsd += leg.amount
        }
      }
      out.push({
        kind: "rebalance_group",
        id: `rebalance-${batchId}`,
        fundingBatchId: batchId,
        date: legs[0]?.date ?? t.date,
        envelopeCount: envelopeIds.size,
        savingsDeltaUsd: Math.round(savingsDeltaUsd * 100) / 100,
      })
      continue
    }
    out.push(t)
  }
  return out
}
