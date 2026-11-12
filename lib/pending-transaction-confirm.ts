import type { PendingTransaction } from "@prisma/client"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

export type ConfirmPendingOverrides = {
  envelopeId?: string
  payee?: string
  amount?: number
  date?: Date
  notes?: string | null
  tags?: string[]
  /** Pre-fetched BTC/USD price for the transaction date. Pass this to avoid
   *  holding the DB transaction connection open during a price cache lookup. */
  btcPrice?: number | null
}

export type ConfirmedPendingTransaction = {
  id: string
  date: string
  payee: string
  amount: number
  type: string
  envelopeId: string
  tags: string[]
  notes: string | null
  satsAmount: number | null
  recurringId: string | null
}

function parseTagsJson(raw: string): string[] {
  try {
    const p = JSON.parse(raw) as unknown
    return Array.isArray(p) && p.every((x) => typeof x === "string") ? p : []
  } catch {
    return []
  }
}

function resolveConfirmFields(
  pending: PendingTransaction,
  overrides: ConfirmPendingOverrides,
): {
  finalPayee: string
  finalDate: Date
  finalAmount: number
  finalNotes: string | null
  finalTags: string
} {
  const finalPayee =
    typeof overrides.payee === "string" && overrides.payee.trim()
      ? overrides.payee.trim()
      : pending.payee
  const finalDate =
    overrides.date instanceof Date && !Number.isNaN(overrides.date.getTime())
      ? overrides.date
      : pending.date
  const finalAmount =
    typeof overrides.amount === "number" &&
    Number.isFinite(overrides.amount) &&
    overrides.amount > 0
      ? overrides.amount
      : Math.abs(pending.amount)
  const finalNotes =
    overrides.notes === null
      ? null
      : typeof overrides.notes === "string"
        ? overrides.notes
        : pending.notes
  const finalTags =
    Array.isArray(overrides.tags) && overrides.tags.every((tag) => typeof tag === "string")
      ? JSON.stringify(overrides.tags.filter((tag) => tag.trim().length > 0))
      : (pending.tags ?? "[]")

  return { finalPayee, finalDate, finalAmount, finalNotes, finalTags }
}

/**
 * Atomically removes a pending row and creates the ledger transaction.
 * A pending credit stays a credit; everything else is an expense.
 * Concurrent confirms for the same pending id create at most one transaction.
 *
 * For efficiency, pre-fetch the BTC price before calling and pass it as
 * `overrides.btcPrice` — this keeps the DB transaction short and matches the
 * pattern used in envelope-sweep.ts.
 */
export async function confirmPendingTransactionAtomic(
  userId: string,
  pendingId: string,
  envelopeId: string,
  overrides: ConfirmPendingOverrides = {},
): Promise<ConfirmedPendingTransaction | null> {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.pendingTransaction.findFirst({
      where: { id: pendingId, userId },
    })
    if (!pending) return null

    const removed = await tx.pendingTransaction.deleteMany({
      where: { id: pendingId, userId },
    })
    if (removed.count !== 1) {
      return null
    }

    const {
      finalPayee,
      finalDate,
      finalAmount,
      finalNotes,
      finalTags,
    } = resolveConfirmFields(pending, overrides)

    // Use a pre-fetched price when available so we don't hold the connection
    // open while querying the price cache (or making an HTTP fallback request).
    const btcPrice =
      overrides.btcPrice !== undefined
        ? overrides.btcPrice
        : await getBtcPriceForDate(finalDate.toISOString().split("T")[0]!)
    const absAmount = Math.abs(finalAmount)

    const ledgerType = pending.type === "credit" ? "credit" : "expense"

    const transaction = await tx.transaction.create({
      data: {
        userId,
        envelopeId,
        date: finalDate,
        payee: finalPayee,
        amount: absAmount,
        type: ledgerType,
        source: pending.source,
        tags: finalTags,
        notes: finalNotes ?? null,
        satsAmount: btcPrice ? usdToSats(absAmount, btcPrice) : null,
      },
    })

    return {
      id: transaction.id,
      date: transaction.date.toISOString().split("T")[0]!,
      payee: transaction.payee,
      amount: transaction.amount,
      type: transaction.type,
      envelopeId: transaction.envelopeId,
      tags: parseTagsJson(transaction.tags),
      notes: transaction.notes ?? null,
      satsAmount: transaction.satsAmount ?? null,
      recurringId: transaction.recurringId ?? null,
    }
  })
}
