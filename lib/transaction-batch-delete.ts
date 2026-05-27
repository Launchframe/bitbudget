import type { Transaction } from "@/lib/data"
import { TX_SOURCE_ENVELOPE_SWEEP, TX_SOURCE_INCOME_IMPORT } from "@/lib/constants"
import { isEnvelopeFundingLeg, isIncomeHeaderTransaction } from "@/lib/ledger-funding-display"

/** Funding legs are batch-managed via their income header; hide list delete. */
export function canDeleteTransactionFromList(
  txn: Pick<Transaction, "source">,
): boolean {
  return !isEnvelopeFundingLeg(txn)
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

/** Server and client delete paths: cascade when the row owns a managed batch. */
export function shouldCascadeDeleteTransactionBatch(
  txn: Pick<Transaction, "type" | "source" | "fundingBatchId">,
): boolean {
  return shouldCascadeDeleteFundingBatch(txn) || shouldCascadeDeleteSweepBatch(txn)
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
