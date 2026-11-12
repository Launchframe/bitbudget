import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"

export type EnvelopeLedgerRow = {
  id: string
  archived?: boolean
  deletedAt?: string | null
  systemRole?: string | null
}

export type TransactionLedgerRow = {
  envelopeId: string
  amount?: number
  excludeFromMainHistory?: boolean
}

/** Envelope ids soft-deleted — their transactions leave the active budget ledger. */
export function deletedEnvelopeIdSet(envelopes: readonly EnvelopeLedgerRow[]): Set<string> {
  return new Set(
    envelopes.filter(e => e.deletedAt != null && e.deletedAt !== "").map(e => e.id),
  )
}

/**
 * Transactions visible in budget ledger feeds (dashboard spend, etc.).
 * Archived envelopes stay in the ledger; only soft-deleted envelopes are excluded.
 */
export function filterTransactionsForActiveLedger<T extends TransactionLedgerRow>(
  transactions: readonly T[],
  envelopes: readonly EnvelopeLedgerRow[],
): T[] {
  const deleted = deletedEnvelopeIdSet(envelopes)
  return transactions.filter(t => !deleted.has(t.envelopeId))
}

/** Discretionary envelopes shown on the allocations page (not Savings / archived / deleted). */
export function discretionaryEnvelopesForAllocations(
  envelopes: readonly (EnvelopeLedgerRow & { name?: string })[],
): EnvelopeLedgerRow[] {
  return envelopes.filter(
    e =>
      !e.archived &&
      (e.deletedAt == null || e.deletedAt === "") &&
      e.systemRole !== SYSTEM_ENVELOPE_ROLE_SAVINGS,
  )
}

export type EnvelopeDeleteUsageStats = {
  transactionCount: number
  transactionTotal: number
  recurringCount: number
}

/** User-facing delete confirmation stats (excludes hidden funding legs). */
export function envelopeDeleteUsageStats(
  transactions: readonly TransactionLedgerRow[],
  recurring: readonly { envelopeId: string }[],
  envelopeId: string,
): EnvelopeDeleteUsageStats {
  const txns = transactions.filter(
    t => t.envelopeId === envelopeId && !t.excludeFromMainHistory,
  )
  return {
    transactionCount: txns.length,
    transactionTotal: txns.reduce((sum, t) => sum + Math.abs(t.amount ?? 0), 0),
    recurringCount: recurring.filter(r => r.envelopeId === envelopeId).length,
  }
}
