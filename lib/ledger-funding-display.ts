import { LEDGER_INCOME_PAYEE_LABEL } from "@/lib/constants"
import type { Transaction } from "@/lib/data"
import { isRebalanceTransferLeg } from "@/lib/rebalance-transaction-display"

export function isEnvelopeFundingLeg(txn: Pick<Transaction, "source">): boolean {
  return txn.source === "envelope_funding_in" || txn.source === "envelope_funding_out"
}

export function isIncomeHeaderTransaction(txn: Pick<Transaction, "source">): boolean {
  return (
    txn.source === "paycheck" ||
    txn.source === "retro_paycheck" ||
    txn.source === "irregular_income" ||
    txn.source === "income_import"
  )
}

export function incomeTransactionForBatch(
  transactions: readonly Transaction[],
  fundingBatchId: string | null | undefined,
): Transaction | undefined {
  if (!fundingBatchId) return undefined
  return transactions.find(
    (t) =>
      t.fundingBatchId === fundingBatchId &&
      isIncomeHeaderTransaction(t) &&
      t.type === "credit",
  )
}

/** O(n) index for repeated payee lookups (e.g. transaction list search). */
export function incomeTransactionsByFundingBatchId(
  transactions: readonly Transaction[],
): Map<string, Transaction> {
  const map = new Map<string, Transaction>()
  for (const t of transactions) {
    if (
      t.fundingBatchId &&
      isIncomeHeaderTransaction(t) &&
      t.type === "credit"
    ) {
      map.set(t.fundingBatchId, t)
    }
  }
  return map
}

function incomeForBatch(
  txn: Pick<Transaction, "fundingBatchId">,
  transactions: readonly Transaction[],
  incomeByBatch?: ReadonlyMap<string, Transaction>,
): Transaction | undefined {
  if (!txn.fundingBatchId) return undefined
  if (incomeByBatch) return incomeByBatch.get(txn.fundingBatchId)
  return incomeTransactionForBatch(transactions, txn.fundingBatchId)
}

function incomeSourceLabel(income: Transaction | undefined): string {
  if (!income) return "Income"
  if (income.source === "paycheck") return "Income"
  if (income.source === "retro_paycheck") return "Missed paycheck"
  const label = income.payee?.trim()
  if (label && label !== LEDGER_INCOME_PAYEE_LABEL) return label
  return "Income"
}

/** User-facing payee column text; links allocation legs to their Income batch header. */
export function displayPayeeForTransaction(
  txn: Transaction,
  transactions: readonly Transaction[],
  incomeByBatch?: ReadonlyMap<string, Transaction>,
): string {
  if (txn.isDecrypted === false) return txn.payee
  if (txn.source === "envelope_funding_in") {
    const income = incomeForBatch(txn, transactions, incomeByBatch)
    const src = incomeSourceLabel(income)
    return src === "Income" ? "From Income" : `From Income · ${src}`
  }
  if (txn.source === "envelope_funding_out") {
    const income = incomeForBatch(txn, transactions, incomeByBatch)
    const src = incomeSourceLabel(income)
    return src === "Income" ? "To envelopes" : `To envelopes · ${src}`
  }
  return txn.payee
}

export function displayTypeLabelForTransaction(txn: Transaction): string {
  if (isRebalanceTransferLeg(txn)) return "Rebalance"
  if (isIncomeHeaderTransaction(txn) || txn.source === "envelope_funding_in") return "Income"
  if (txn.type === "expense") return "Expense"
  return "Credit"
}

/** UI type filter values (includes Income, which is not a stored Transaction.type). */
export type TransactionListTypeFilter = "all" | "expense" | "credit" | "income"

export function transactionMatchesTypeFilter(
  txn: Transaction,
  filter: TransactionListTypeFilter,
): boolean {
  if (filter === "all") return true
  // Rebalance transfer legs are their own display type; only "All Types" lists them.
  if (isRebalanceTransferLeg(txn)) return false
  const label = displayTypeLabelForTransaction(txn).toLowerCase()
  if (filter === "income") return label === "income"
  if (filter === "expense") return label === "expense"
  return label === "credit"
}

/** Badge styles for synthetic rebalance group rows (matches Rebalance transfer legs). */
export const REBALANCE_TYPE_BADGE_CLASS =
  "border-[#6366F1]/35 text-[#A5B4FC] bg-[#6366F1]/10"

export function typeBadgeClassForTransaction(txn: Transaction): string {
  if (isRebalanceTransferLeg(txn)) {
    return REBALANCE_TYPE_BADGE_CLASS
  }
  if (
    isIncomeHeaderTransaction(txn) ||
    txn.source === "envelope_funding_in"
  ) {
    return "border-[#22C55E]/30 text-[#22C55E] bg-[#22C55E]/5"
  }
  if (txn.type === "expense" || txn.source === "envelope_funding_out") {
    return "border-[#F7931A]/30 text-[#F7931A] bg-[#F7931A]/5"
  }
  return "border-[#22C55E]/30 text-[#22C55E] bg-[#22C55E]/5"
}
