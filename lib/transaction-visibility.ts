import {
  TX_SOURCE_DEFICIT_COVER,
  TX_SOURCE_ENVELOPE_TRANSFER_OUT,
} from "@/lib/constants"
import type { Transaction } from "@/lib/data"
import { isEnvelopeFundingLeg } from "@/lib/ledger-funding-display"
import {
  isShoppingManagedSource,
  isShoppingPersonalSpend,
} from "@/lib/shopping-classification"

/** Expense rows visible in history but not external/user spending (move funds, deficit cover). */
function isInternalLedgerTransferExpense(
  txn: Pick<Transaction, "source">,
): boolean {
  const src = txn.source
  return src === TX_SOURCE_ENVELOPE_TRANSFER_OUT || src === TX_SOURCE_DEFICIT_COVER
}

/** Real user spending — not ledger allocation legs hidden from main history. */
export function isUserFacingExpense(
  txn: Pick<Transaction, "type" | "excludeFromMainHistory" | "source">,
): boolean {
  if (txn.type !== "expense") return false
  if (txn.excludeFromMainHistory) return false
  if (isEnvelopeFundingLeg(txn)) return false
  if (isInternalLedgerTransferExpense(txn)) return false
  if (isShoppingManagedSource(txn.source)) return isShoppingPersonalSpend(txn)
  return true
}

export function filterUserFacingExpenses(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter(isUserFacingExpense)
}

export function txnIsoDate(date: string): string {
  return date.split("T")[0]!
}

export function todayUtcIso(now = new Date()): string {
  return now.toISOString().split("T")[0]!
}
