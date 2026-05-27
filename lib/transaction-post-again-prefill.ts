import type { Transaction } from "@/lib/data"
import type { TransactionPrefill } from "@/lib/app-context"
import { isEnvelopeFundingLeg } from "@/lib/ledger-funding-display"
import { todayTransactionCalendarDay } from "@/lib/transaction-dates"

/** Build new-transaction prefill from an existing row (date defaults to today). */
export function transactionPostAgainPrefill(
  txn: Pick<
    Transaction,
    | "payee"
    | "amount"
    | "type"
    | "envelopeId"
    | "tags"
    | "notes"
    | "isDecrypted"
    | "source"
  >,
  now = new Date(),
): TransactionPrefill | null {
  if (txn.isDecrypted === false) return null
  if (isEnvelopeFundingLeg(txn)) return null
  return {
    payee: txn.payee,
    amount: String(txn.amount),
    type: txn.type,
    envelopeId: txn.envelopeId,
    tags: txn.tags,
    notes: txn.notes ?? undefined,
    date: todayTransactionCalendarDay(now),
  }
}
