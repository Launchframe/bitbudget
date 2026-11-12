import type { Transaction, TransactionType } from "@/lib/data"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import { transactionCalendarDay } from "@/lib/transaction-dates"
import { collapsePayeeSoftKey, normalizePayeeKey } from "@/lib/payee-canonical"

/**
 * Integer cents from absolute USD for stable collision keys (avoids float artifacts like
 * `Math.round(1.005 * 100) === 100` in IEEE doubles).
 */
export function normalizeDedupCents(amount: number): number {
  const n = Number(amount)
  if (!Number.isFinite(n)) return 0
  const abs = Math.abs(n)
  if (abs === 0) return 0
  // Huge/tiny doubles stringify as `1e+21`, which must not become `1e+21e2` (invalid concatenation).
  const asStr = String(abs)
  if (!/[eE]/.test(asStr)) {
    const scaled = Number(`${abs}e2`)
    if (Number.isFinite(scaled)) return Math.round(scaled)
  }
  return Math.round(abs * 100)
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
  return `${transactionCalendarDay(candidate.date)}|${candidate.type}|${payeeNorm}|${cents}`
}

export interface PayeeMatchCandidate {
  transaction: Transaction
  confidence: "high" | "medium"
}

/**
 * Finds existing transactions that match on date + type + amount, ignoring payee.
 * Used to suggest payee aliases during statement import.
 *
 * Returns empty array if:
 * - The candidate already has an exact dupe (findCollidingTransaction handles it)
 * - No amount+date matches are found
 * - All matches have the same payee as the candidate (no alias needed)
 *
 * Confidence:
 *   high   — exactly 1 match, payees differ; boosted by soft-key equality
 *   medium — 2+ matches (ambiguous)
 */
export function findPayeeAgnosticMatches(
  transactions: readonly Transaction[],
  candidate: { date: string; amount: number; type: TransactionType; payee: string },
): PayeeMatchCandidate[] {
  const dayKey = transactionCalendarDay(candidate.date)
  const cents = normalizeDedupCents(candidate.amount)
  const matchKey = `${dayKey}|${candidate.type}|${cents}`
  const candidateNorm = normalizePayeeKey(candidate.payee)

  const matches: Transaction[] = []
  for (const t of transactions) {
    if (t.payee === ENCRYPTED_DISPLAY) continue
    const tKey = `${transactionCalendarDay(t.date)}|${t.type}|${normalizeDedupCents(t.amount)}`
    if (tKey !== matchKey) continue
    if (normalizePayeeKey(t.payee) === candidateNorm) continue // same payee — no alias needed
    matches.push(t)
  }

  if (matches.length === 0) return []

  if (matches.length === 1) {
    const match = matches[0]!
    // Boost to high if soft keys are equal (Wal-Mart ↔ Walmart)
    const softEqual =
      collapsePayeeSoftKey(match.payee) === collapsePayeeSoftKey(candidate.payee)
    return [{ transaction: match, confidence: softEqual ? "high" : "high" }]
  }

  // Multiple matches — pick highest-frequency payee for the suggestion, mark medium
  return matches.map(t => ({ transaction: t, confidence: "medium" as const }))
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
