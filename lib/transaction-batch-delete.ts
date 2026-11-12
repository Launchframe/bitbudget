import type { Transaction } from "@/lib/data"
import {
  TX_SOURCE_ENVELOPE_SWEEP,
  TX_SOURCE_ENVELOPE_TRANSFER_IN,
  TX_SOURCE_ENVELOPE_TRANSFER_OUT,
  TX_SOURCE_INCOME_IMPORT,
} from "@/lib/constants"
import { isEnvelopeFundingLeg, isIncomeHeaderTransaction } from "@/lib/ledger-funding-display"
import { isRebalanceTransferLeg } from "@/lib/rebalance-transaction-display"

/** Funding legs are batch-managed via their income header; hide list delete. */
export function canDeleteTransactionFromList(
  txn: Pick<Transaction, "source" | "fundingBatchKind">,
): boolean {
  return !isEnvelopeFundingLeg(txn) && !isRebalanceTransferLeg(txn)
}

/** Income header deletes remove the whole funding batch (income + allocation legs). */
export function shouldCascadeDeleteFundingBatch(
  txn: Pick<Transaction, "type" | "source" | "fundingBatchId">,
): boolean {
  return (
    txn.type === "credit" &&
    txn.fundingBatchId != null &&
    txn.fundingBatchId.length > 0 &&
    isIncomeHeaderTransaction(txn)
  )
}

/** Sweep rows are paired (envelope expense + Savings credit); delete any leg removes the batch. */
export function shouldCascadeDeleteSweepBatch(
  txn: Pick<Transaction, "source" | "fundingBatchId">,
): boolean {
  return (
    txn.fundingBatchId != null &&
    txn.fundingBatchId.length > 0 &&
    txn.source === TX_SOURCE_ENVELOPE_SWEEP
  )
}

/** Rebalance / move-funds transfer legs delete as a batch from the header leg. */
export function shouldCascadeDeleteRebalanceBatch(
  txn: Pick<Transaction, "source" | "fundingBatchId" | "fundingBatchKind">,
): boolean {
  if (!txn.fundingBatchId?.length) return false
  const kind = txn.fundingBatchKind
  if (kind === "rebalance" || kind === "move_funds") return true
  return (
    txn.source === TX_SOURCE_ENVELOPE_TRANSFER_IN ||
    txn.source === TX_SOURCE_ENVELOPE_TRANSFER_OUT
  )
}

/** Server and client delete paths: cascade when the row owns a managed batch. */
export function shouldCascadeDeleteTransactionBatch(
  txn: Pick<Transaction, "type" | "source" | "fundingBatchId" | "fundingBatchKind">,
): boolean {
  return (
    shouldCascadeDeleteFundingBatch(txn) ||
    shouldCascadeDeleteSweepBatch(txn) ||
    shouldCascadeDeleteRebalanceBatch(txn)
  )
}

export function incomeBatchHasFundingLegs(
  fundingBatchId: string | null | undefined,
  txnId: string,
  transactions: readonly Transaction[],
): boolean {
  if (!fundingBatchId) return false
  return transactions.some(
    (t) => t.fundingBatchId === fundingBatchId && t.id !== txnId && isEnvelopeFundingLeg(t),
  )
}

export function shouldConfirmIncomeBatchDelete(
  txn: Transaction,
  transactions: readonly Transaction[],
): boolean {
  return (
    shouldCascadeDeleteFundingBatch(txn) &&
    incomeBatchHasFundingLegs(txn.fundingBatchId, txn.id, transactions)
  )
}

export function incomeBatchDeleteConfirmMessage(source: Transaction["source"]): string {
  if (source === TX_SOURCE_INCOME_IMPORT) {
    return "Deleting this past income will also remove its envelope funding entries for that period. This keeps your chart and envelope balances in sync."
  }
  return "Deleting this income will also remove its envelope funding entries. This keeps your chart and envelope balances in sync."
}

export function sweepBatchHasPairedLeg(
  fundingBatchId: string | null | undefined,
  txnId: string,
  transactions: readonly Transaction[],
): boolean {
  if (!fundingBatchId) return false
  return transactions.some(
    (t) =>
      t.fundingBatchId === fundingBatchId &&
      t.id !== txnId &&
      t.source === TX_SOURCE_ENVELOPE_SWEEP,
  )
}

export function shouldConfirmSweepBatchDelete(
  txn: Transaction,
  transactions: readonly Transaction[],
): boolean {
  return (
    shouldCascadeDeleteSweepBatch(txn) &&
    sweepBatchHasPairedLeg(txn.fundingBatchId, txn.id, transactions)
  )
}

export const SWEEP_BATCH_DELETE_CONFIRM_MESSAGE =
  "Deleting this will also remove the matching envelope and Savings entries from this sweep. This keeps your balances in sync."
