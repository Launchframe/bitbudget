import type { Transaction } from "@/lib/data"
import { isEnvelopeFundingLeg } from "@/lib/ledger-funding-display"

/** Real user spending — not ledger allocation legs hidden from main history. */
export function isUserFacingExpense(
  txn: Pick<Transaction, "type" | "excludeFromMainHistory" | "source">,
): boolean {
  if (txn.type !== "expense") return false
  if (txn.excludeFromMainHistory) return false
  if (isEnvelopeFundingLeg(txn)) return false
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
