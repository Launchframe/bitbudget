import type { Transaction, TransactionType } from "@/lib/data"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"

/**
 * Integer cents from absolute USD for stable collision keys (avoids float artifacts like
 * `Math.round(1.005 * 100) === 100` in IEEE doubles).
 */
export function normalizeDedupCents(amount: number): number {
  const n = Number(amount)
  if (!Number.isFinite(n)) return 0
  return Math.round(Number(`${Math.abs(n)}e2`))
}

/** Normalize USD amounts so 10 and 10.00 collide consistently. */
export function normalizeDedupAmount(amount: number): number {
  return normalizeDedupCents(amount) / 100
}

/**
 * Same calendar date + type + payee (trimmed, case-insensitive) + normalized absolute amount (as cents integer).
 */
export function transactionCollisionKey(candidate: {
  date: string
  payee: string
  amount: number
  type: TransactionType
}): string {
  const payeeNorm = candidate.payee.toLowerCase().trim()
  const cents = normalizeDedupCents(candidate.amount)
  return `${candidate.date}|${candidate.type}|${payeeNorm}|${cents}`
}

export function findCollidingTransaction(
  transactions: readonly Transaction[],
  candidate: { date: string; payee: string; amount: number; type: TransactionType },
): Transaction | undefined {
  const key = transactionCollisionKey(candidate)
  for (const t of transactions) {
    if (t.payee === ENCRYPTED_DISPLAY) continue
    if (
      transactionCollisionKey({
        date: t.date,
        payee: t.payee,
        amount: t.amount,
        type: t.type,
      }) === key
    ) {
      return t
    }
  }
  return undefined
}
