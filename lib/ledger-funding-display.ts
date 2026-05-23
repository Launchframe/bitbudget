import { LEDGER_INCOME_PAYEE_LABEL } from "@/lib/constants"
import type { Transaction } from "@/lib/data"

export function isEnvelopeFundingLeg(txn: Pick<Transaction, "source">): boolean {
  return txn.source === "envelope_funding_in" || txn.source === "envelope_funding_out"
}

export function isIncomeHeaderTransaction(txn: Pick<Transaction, "source">): boolean {
  return txn.source === "paycheck" || txn.source === "irregular_income"
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

function incomeSourceLabel(income: Transaction | undefined): string {
  if (!income) return "Income"
  if (income.source === "paycheck") return "Income"
  const label = income.payee?.trim()
  if (label && label !== LEDGER_INCOME_PAYEE_LABEL) return label
  return "Income"
}

/** User-facing payee column text; links allocation legs to their Income batch header. */
export function displayPayeeForTransaction(
  txn: Transaction,
  transactions: readonly Transaction[],
): string {
  if (txn.source === "envelope_funding_in") {
    const income = incomeTransactionForBatch(transactions, txn.fundingBatchId)
    const src = incomeSourceLabel(income)
    return src === "Income" ? "From Income" : `From Income · ${src}`
  }
  if (txn.source === "envelope_funding_out") {
    const income = incomeTransactionForBatch(transactions, txn.fundingBatchId)
    const src = incomeSourceLabel(income)
    return src === "Income" ? "To envelopes" : `To envelopes · ${src}`
  }
  return txn.payee
}

export function displayTypeLabelForTransaction(txn: Transaction): string {
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
  const label = displayTypeLabelForTransaction(txn).toLowerCase()
  if (filter === "income") return label === "income"
  if (filter === "expense") return label === "expense"
  return label === "credit"
}

export function typeBadgeClassForTransaction(txn: Transaction): string {
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
