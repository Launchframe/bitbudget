import {
  TX_SOURCE_DEFICIT_COVER,
  TX_SOURCE_ENVELOPE_TRANSFER_OUT,
} from "@/lib/constants"
import type { Transaction } from "@/lib/data"
import { isEnvelopeFundingLeg } from "@/lib/ledger-funding-display"
import { isPrivateTransaction } from "@/lib/constants"

/** Expense rows visible in history but not external/user spending (move funds, deficit cover). */
function isInternalLedgerTransferExpense(
  txn: Pick<Transaction, "source">,
): boolean {
  const src = txn.source
  return src === TX_SOURCE_ENVELOPE_TRANSFER_OUT || src === TX_SOURCE_DEFICIT_COVER
}

/** Real user spending — not ledger allocation legs hidden from main history. */
export function isUserFacingExpense(
  txn: Pick<Transaction, "type" | "excludeFromMainHistory" | "source" | "tags">,
): boolean {
  if (txn.type !== "expense") return false
  if (txn.excludeFromMainHistory) return false
  if (isEnvelopeFundingLeg(txn)) return false
  if (isInternalLedgerTransferExpense(txn)) return false
  return true
}

/** User-facing expenses excluding private-tagged transactions (for analytics/OC). */
export function isAnalyticsExpense(
  txn: Pick<Transaction, "type" | "excludeFromMainHistory" | "source" | "tags">,
): boolean {
  if (!isUserFacingExpense(txn)) return false
  if (isPrivateTransaction(txn.tags)) return false
  return true
}

export function filterUserFacingExpenses(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter(isUserFacingExpense)
}

/** Filter to analytics-eligible expenses (excludes private tag). */
export function filterAnalyticsExpenses(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter(isAnalyticsExpense)
}

export function txnIsoDate(date: string): string {
  return date.split("T")[0]!
}

export function todayUtcIso(now = new Date()): string {
  return now.toISOString().split("T")[0]!
}
