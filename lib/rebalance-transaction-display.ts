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

function savingsDeltaFromLegs(
  legs: readonly Transaction[],
  savingsEnvelopeId: string | null | undefined,
): number {
  if (!savingsEnvelopeId) return 0
  let savingsDeltaUsd = 0
  for (const leg of legs) {
    if (leg.envelopeId !== savingsEnvelopeId) continue
    if (leg.source === TX_SOURCE_ENVELOPE_TRANSFER_IN) {
      savingsDeltaUsd += leg.amount
    } else if (leg.source === TX_SOURCE_ENVELOPE_TRANSFER_OUT) {
      savingsDeltaUsd -= leg.amount
    }
  }
  return savingsDeltaUsd
}

/** Collapse rebalance transfer legs into one summary row per batch (newest-first list order preserved). */
export function collapseRebalanceBatches(
  transactions: readonly Transaction[],
  savingsEnvelopeId?: string | null,
): TransactionListRow[] {
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
      const envelopeIds = new Set<string>()
      for (const leg of legs) {
        envelopeIds.add(leg.envelopeId)
      }
      const savingsDeltaUsd = savingsDeltaFromLegs(legs, savingsEnvelopeId)
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
