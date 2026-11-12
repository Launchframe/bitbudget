/**
 * Client-side duplicate detection for the manual cleanup tool.
 *
 * Groups decrypted transactions that share the same business identity
 * (date + type + normalized payee + amount, via `transactionCollisionKey`).
 * Only rows that are safe to delete individually are considered — encrypted/locked
 * rows (payee unreadable) and funding-batch rows (income headers, sweeps, allocation
 * legs) are excluded so plain bulk delete never orphans paired ledger entries.
 */
import type { Transaction } from "@/lib/data"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import { transactionCollisionKey } from "@/lib/transaction-dedup"
import {
  canDeleteTransactionFromList,
  shouldCascadeDeleteTransactionBatch,
} from "@/lib/transaction-batch-delete"

export interface DuplicateCluster {
  key: string
  /** Sorted oldest-first; the first row is the suggested keeper. */
  transactions: Transaction[]
}

/** A row qualifies for cleanup only if it is readable and safe to delete on its own. */
export function isCleanupEligible(txn: Transaction): boolean {
  if (txn.isDecrypted === false) return false
  if (txn.payee === ENCRYPTED_DISPLAY) return false
  if (!canDeleteTransactionFromList(txn)) return false
  if (shouldCascadeDeleteTransactionBatch(txn)) return false
  return true
}

function keepRank(t: Transaction): number {
  // Keep the earliest row: prefer createdAt, then date.
  const created = t.createdAt ? Date.parse(t.createdAt) : NaN
  if (Number.isFinite(created)) return created
  const dated = Date.parse(t.date)
  return Number.isFinite(dated) ? dated : 0
}

export function findDuplicateClusters(
  transactions: readonly Transaction[],
): DuplicateCluster[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (!isCleanupEligible(t)) continue
    const key = transactionCollisionKey({
      date: t.date,
      payee: t.payee,
      amount: t.amount,
      type: t.type,
    })
    const arr = groups.get(key)
    if (arr) arr.push(t)
    else groups.set(key, [t])
  }

  const clusters: DuplicateCluster[] = []
  for (const [key, txns] of groups) {
    if (txns.length < 2) continue
    const sorted = [...txns].sort(
      (a, b) => keepRank(a) - keepRank(b) || a.id.localeCompare(b.id),
    )
    clusters.push({ key, transactions: sorted })
  }

  // Largest clusters first so the most impactful cleanups surface at the top.
  clusters.sort((a, b) => b.transactions.length - a.transactions.length)
  return clusters
}

/** Total number of extra (deletable) rows across all clusters. */
export function duplicateRowCount(clusters: readonly DuplicateCluster[]): number {
  return clusters.reduce((sum, c) => sum + (c.transactions.length - 1), 0)
}

/** Default deletion selection: every row except the keeper (first) in each cluster. */
export function defaultDeleteSelection(clusters: readonly DuplicateCluster[]): Set<string> {
  const ids = new Set<string>()
  for (const c of clusters) {
    for (let i = 1; i < c.transactions.length; i++) ids.add(c.transactions[i].id)
  }
  return ids
}
