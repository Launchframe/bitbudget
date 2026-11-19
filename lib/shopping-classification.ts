/**
 * Personal-spend vs cash-movement classification for shopping-managed transactions.
 * Envelope remaining still includes every credit/expense on that envelope.
 */

import type { Transaction } from "@/lib/data"
import {
  TX_SOURCE_SHOPPING_ADVANCE_OUT,
  TX_SOURCE_SHOPPING_ADVANCE_RECOVERY,
  TX_SOURCE_SHOPPING_CORRECTION,
  TX_SOURCE_SHOPPING_OWN_EXPENSE,
  TX_SOURCE_SHOPPING_PREPAID_APPLY,
  TX_SOURCE_SHOPPING_PREPAID_IN,
  TX_SOURCE_SHOPPING_PREPAID_OUT,
  TX_SOURCE_SHOPPING_REPAYMENT_EXPENSE,
} from "@/lib/constants"

export const SHOPPING_MANAGED_SOURCES = [
  TX_SOURCE_SHOPPING_OWN_EXPENSE,
  TX_SOURCE_SHOPPING_ADVANCE_OUT,
  TX_SOURCE_SHOPPING_ADVANCE_RECOVERY,
  TX_SOURCE_SHOPPING_REPAYMENT_EXPENSE,
  TX_SOURCE_SHOPPING_PREPAID_OUT,
  TX_SOURCE_SHOPPING_PREPAID_IN,
  TX_SOURCE_SHOPPING_PREPAID_APPLY,
  TX_SOURCE_SHOPPING_CORRECTION,
] as const

export type ShoppingManagedSource = (typeof SHOPPING_MANAGED_SOURCES)[number]

const MANAGED = new Set<string>(SHOPPING_MANAGED_SOURCES)

/** Grocery consumption that should appear in Monthly Spend / spending charts. */
const PERSONAL_SPEND = new Set<string>([
  TX_SOURCE_SHOPPING_OWN_EXPENSE,
  TX_SOURCE_SHOPPING_REPAYMENT_EXPENSE,
  TX_SOURCE_SHOPPING_PREPAID_APPLY,
])

/** Real money leaving the member's pocket. */
const CASH_OUT = new Set<string>([
  TX_SOURCE_SHOPPING_OWN_EXPENSE,
  TX_SOURCE_SHOPPING_ADVANCE_OUT,
  TX_SOURCE_SHOPPING_REPAYMENT_EXPENSE,
  TX_SOURCE_SHOPPING_PREPAID_OUT,
])

/** Real money returning to the member (recoveries / prepaid receipts / refunds). Not income. */
const CASH_IN = new Set<string>([
  TX_SOURCE_SHOPPING_ADVANCE_RECOVERY,
  TX_SOURCE_SHOPPING_PREPAID_IN,
])

export function isShoppingManagedSource(source: string | null | undefined): source is ShoppingManagedSource {
  return typeof source === "string" && MANAGED.has(source)
}

export function isShoppingPersonalSpend(
  txn: Pick<Transaction, "type" | "source" | "excludeFromMainHistory">,
): boolean {
  if (txn.type !== "expense" || txn.excludeFromMainHistory) return false
  return PERSONAL_SPEND.has(txn.source ?? "")
}

export function isShoppingCashOutflow(
  txn: Pick<Transaction, "type" | "source" | "excludeFromMainHistory">,
): boolean {
  if (txn.type !== "expense" || txn.excludeFromMainHistory) return false
  return CASH_OUT.has(txn.source ?? "")
}

export function isShoppingCashInflow(
  txn: Pick<Transaction, "type" | "source" | "excludeFromMainHistory">,
): boolean {
  if (txn.type !== "credit" || txn.excludeFromMainHistory) return false
  return CASH_IN.has(txn.source ?? "")
}

/** Recoveries and prepaid receipts must not count as income or Savings growth. */
export function isShoppingNonIncomeCredit(
  txn: Pick<Transaction, "type" | "source">,
): boolean {
  return txn.type === "credit" && CASH_IN.has(txn.source ?? "")
}
