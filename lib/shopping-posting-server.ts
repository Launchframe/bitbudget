/**
 * Caller-owned private shopping postings. Writes only session.user.id envelopes.
 */

import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import { parseTransactionDateInput } from "@/lib/transaction-dates"
import { looksLikeAsymmetricCiphertext } from "@/lib/crypto"
import { centsToDollars } from "@/lib/shopping-split-math"
import { isShoppingManagedSource } from "@/lib/shopping-classification"
import { ShoppingHttpError, requireActiveMember } from "@/lib/shopping-server"
import { SHOPPING_ENTRY_KINDS, type ShoppingEntryKind } from "@/lib/shopping-types"
import {
  eventAllowedByBudgetOptIn,
  expectedShoppingEntryType,
  kindToTransactionSource,
} from "@/lib/shopping-budget-projection"

export interface ShoppingPostingEntryInput {
  entryKey: string
  kind: ShoppingEntryKind
  cents: number
  type: "expense" | "credit"
  postedOn: string
  payee: string
  notes?: string | null
  envelopeId: string
}

function assertEnvelopeMatchesPreference(
  pref: { envelopeId: string | null },
  entryEnvelopeId: string,
) {
  if (!pref.envelopeId || entryEnvelopeId !== pref.envelopeId) {
    throw new ShoppingHttpError("Use the envelope selected in your budget settings", 400)
  }
}

function assertEventInOptInWindow(
  pref: { catchUpApproved: boolean; enabledAtSequence: number | null },
  eventSequence: number,
) {
  if (
    !eventAllowedByBudgetOptIn({
      catchUpApproved: pref.catchUpApproved,
      enabledAtSequence: pref.enabledAtSequence,
      eventSequence,
    })
  ) {
    throw new ShoppingHttpError("This purchase is from before you turned budgeting on.", 409)
  }
}

type PostingWriteOutcome =
  | { outcome: "created"; id: string }
  | { outcome: "skipped" }
  | { outcome: "needs_attention" }

export async function listCallerPostings(params: {
  userId: string
  groupId: string
}): Promise<Array<{ eventId: string; entryKey: string; status: string }>> {
  await requireActiveMember(params.groupId, params.userId)
  return prisma.shoppingPosting.findMany({
    where: { userId: params.userId, groupId: params.groupId },
    select: { eventId: true, entryKey: true, status: true },
    orderBy: { createdAt: "asc" },
  })
}

export async function applyShoppingPostings(params: {
  userId: string
  groupId: string
  eventId: string
  preferenceVersion: number
  projectionRevision: number
  entries: ShoppingPostingEntryInput[]
}): Promise<{
  createdIds: string[]
  skipped: string[]
  needsAttention: string[]
}> {
  await requireActiveMember(params.groupId, params.userId)
  const event = await prisma.shoppingEvent.findFirst({
    where: { id: params.eventId, groupId: params.groupId },
  })
  if (!event) throw new ShoppingHttpError("Shared event not found", 404)

  const pref = await prisma.shoppingBudgetPreference.findFirst({
    where: { groupId: params.groupId, userId: params.userId },
  })
  if (!pref || !pref.enabled) {
    throw new ShoppingHttpError("Turn on automatic budgeting for this group first", 409)
  }
  if (pref.preferenceVersion !== params.preferenceVersion) {
    throw new ShoppingHttpError("Budget settings changed on another device. Refresh and try again.", 409)
  }

  const createdIds: string[] = []
  const skipped: string[] = []
  const needsAttention: string[] = []

  for (const entry of params.entries) {
    if (!SHOPPING_ENTRY_KINDS.includes(entry.kind)) {
      throw new ShoppingHttpError("Unknown shopping entry type", 400)
    }
    if (!Number.isInteger(entry.cents) || entry.cents < 0) {
      throw new ShoppingHttpError("Amount must be whole cents", 400)
    }
    if (entry.type !== "expense" && entry.type !== "credit") {
      throw new ShoppingHttpError("type must be expense or credit", 400)
    }
    const expectedType = expectedShoppingEntryType(entry.kind)
    if (expectedType !== "either" && entry.type !== expectedType) {
      throw new ShoppingHttpError("This shared-list entry cannot be saved that way.", 400)
    }
    if (!looksLikeAsymmetricCiphertext(entry.payee)) {
      throw new ShoppingHttpError("Payee must be encrypted", 400)
    }
    if (entry.notes != null && entry.notes !== "" && !looksLikeAsymmetricCiphertext(entry.notes)) {
      throw new ShoppingHttpError("Notes must be encrypted", 400)
    }
    const txnDate = parseTransactionDateInput(entry.postedOn)
    if (!txnDate) throw new ShoppingHttpError("Invalid date", 400)
    const source = kindToTransactionSource(entry.kind)
    if (!isShoppingManagedSource(source)) {
      throw new ShoppingHttpError("Invalid shopping source", 400)
    }

    assertEnvelopeMatchesPreference(pref, entry.envelopeId)
    assertEventInOptInWindow(pref, event.sequence)

    const existing = await prisma.shoppingPosting.findUnique({
      where: {
        userId_eventId_entryKey: {
          userId: params.userId,
          eventId: params.eventId,
          entryKey: entry.entryKey,
        },
      },
      include: { transactions: true },
    })
    if (existing?.status === "skipped" || existing?.status === "suppressed") {
      skipped.push(entry.entryKey)
      continue
    }
    if (existing?.status === "posted" && existing.transactions.length > 0) {
      createdIds.push(existing.transactions[0]!.id)
      continue
    }

    const amount = centsToDollars(entry.cents)
    const btcPrice = await getBtcPriceForDate(entry.postedOn)

    try {
      const result = await prisma.$transaction(async (tx) => {
        const fresh = await tx.shoppingBudgetPreference.findFirst({
          where: { groupId: params.groupId, userId: params.userId },
        })
        if (!fresh || !fresh.enabled || fresh.preferenceVersion !== params.preferenceVersion) {
          throw new ShoppingHttpError("Budget settings changed on another device. Refresh and try again.", 409)
        }
        assertEnvelopeMatchesPreference(fresh, entry.envelopeId)
        assertEventInOptInWindow(fresh, event.sequence)

        const current = await tx.shoppingPosting.findUnique({
          where: {
            userId_eventId_entryKey: {
              userId: params.userId,
              eventId: params.eventId,
              entryKey: entry.entryKey,
            },
          },
          include: { transactions: true },
        })
        if (current?.status === "skipped" || current?.status === "suppressed") {
          return { outcome: "skipped" } satisfies PostingWriteOutcome
        }
        if (current?.status === "posted" && current.transactions.length > 0) {
          return { outcome: "created", id: current.transactions[0]!.id } satisfies PostingWriteOutcome
        }

        const envelope = await tx.envelope.findFirst({
          where: {
            id: entry.envelopeId,
            userId: params.userId,
            deletedAt: null,
            archived: false,
            systemRole: null,
          },
        })
        if (!envelope) {
          if (!current) {
            await tx.shoppingPosting.create({
              data: {
                userId: params.userId,
                groupId: params.groupId,
                eventId: params.eventId,
                entryKey: entry.entryKey,
                projectionRevision: params.projectionRevision,
                status: "needs_attention",
              },
            })
          } else {
            await tx.shoppingPosting.updateMany({
              where: { id: current.id, status: { in: ["needs_attention", "posted"] } },
              data: { status: "needs_attention", projectionRevision: params.projectionRevision },
            })
          }
          return { outcome: "needs_attention" } satisfies PostingWriteOutcome
        }

        let postingId = current?.id
        if (!postingId) {
          const createdPosting = await tx.shoppingPosting.create({
            data: {
              userId: params.userId,
              groupId: params.groupId,
              eventId: params.eventId,
              entryKey: entry.entryKey,
              projectionRevision: params.projectionRevision,
              status: "posted",
            },
          })
          postingId = createdPosting.id
        } else {
          const marked = await tx.shoppingPosting.updateMany({
            where: { id: postingId, status: { in: ["needs_attention", "posted"] } },
            data: { status: "posted", projectionRevision: params.projectionRevision },
          })
          if (marked.count !== 1) return { outcome: "skipped" } satisfies PostingWriteOutcome
        }

        const already = await tx.transaction.findFirst({
          where: { shoppingPostingId: postingId, userId: params.userId },
        })
        if (already) return { outcome: "created", id: already.id } satisfies PostingWriteOutcome
        const created = await tx.transaction.create({
          data: {
            userId: params.userId,
            envelopeId: envelope.id,
            date: txnDate,
            payee: entry.payee,
            amount,
            type: entry.type,
            notes: entry.notes ?? null,
            source,
            shoppingPostingId: postingId,
            satsAmount: btcPrice ? usdToSats(amount, btcPrice) : null,
          },
        })
        return { outcome: "created", id: created.id } satisfies PostingWriteOutcome
      })
      if (result.outcome === "skipped") skipped.push(entry.entryKey)
      else if (result.outcome === "needs_attention") needsAttention.push(entry.entryKey)
      else createdIds.push(result.id)
    } catch (err) {
      if (err instanceof ShoppingHttpError) throw err
      const code = (err as { code?: string }).code
      if (code === "P2002") {
        const row = await prisma.shoppingPosting.findUnique({
          where: {
            userId_eventId_entryKey: {
              userId: params.userId,
              eventId: params.eventId,
              entryKey: entry.entryKey,
            },
          },
          include: { transactions: true },
        })
        if (row?.transactions[0]) createdIds.push(row.transactions[0].id)
        else skipped.push(entry.entryKey)
        continue
      }
      throw err
    }
  }

  return { createdIds, skipped, needsAttention }
}

async function classifySkipConflict(params: {
  userId: string
  eventId: string
  entryKey: string
}): Promise<void> {
  const row = await prisma.shoppingPosting.findUnique({
    where: {
      userId_eventId_entryKey: {
        userId: params.userId,
        eventId: params.eventId,
        entryKey: params.entryKey,
      },
    },
    include: { transactions: true },
  })
  if (!row || row.status === "skipped" || row.status === "suppressed") return
  if (row.status === "posted" || row.transactions.length > 0) {
    throw new ShoppingHttpError("This is already in your budget", 409)
  }
  await prisma.shoppingPosting.updateMany({
    where: { id: row.id, status: { notIn: ["posted", "skipped", "suppressed"] } },
    data: { status: "skipped" },
  })
}

export async function skipShoppingPosting(params: {
  userId: string
  groupId: string
  eventId: string
  entryKey: string
  preferenceVersion: number
}): Promise<void> {
  await requireActiveMember(params.groupId, params.userId)
  const event = await prisma.shoppingEvent.findFirst({
    where: { id: params.eventId, groupId: params.groupId },
    select: { id: true },
  })
  if (!event) throw new ShoppingHttpError("Shared event not found", 404)
  const pref = await prisma.shoppingBudgetPreference.findFirst({
    where: { groupId: params.groupId, userId: params.userId },
  })
  if (!pref || pref.preferenceVersion !== params.preferenceVersion) {
    throw new ShoppingHttpError("Budget settings changed on another device. Refresh and try again.", 409)
  }
  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.shoppingBudgetPreference.findFirst({
        where: { groupId: params.groupId, userId: params.userId },
      })
      if (!fresh || fresh.preferenceVersion !== params.preferenceVersion) {
        throw new ShoppingHttpError("Budget settings changed on another device. Refresh and try again.", 409)
      }
      const existing = await tx.shoppingPosting.findUnique({
        where: {
          userId_eventId_entryKey: {
            userId: params.userId,
            eventId: params.eventId,
            entryKey: params.entryKey,
          },
        },
        include: { transactions: true },
      })
      if (existing?.status === "skipped" || existing?.status === "suppressed") return
      if (existing?.status === "posted" || (existing?.transactions.length ?? 0) > 0) {
        throw new ShoppingHttpError("This is already in your budget", 409)
      }
      if (!existing) {
        await tx.shoppingPosting.create({
          data: {
            userId: params.userId,
            groupId: params.groupId,
            eventId: params.eventId,
            entryKey: params.entryKey,
            projectionRevision: 0,
            status: "skipped",
          },
        })
        return
      }
      const marked = await tx.shoppingPosting.updateMany({
        where: { id: existing.id, status: { notIn: ["posted", "skipped", "suppressed"] } },
        data: { status: "skipped" },
      })
      if (marked.count !== 1) {
        throw new ShoppingHttpError("This is already in your budget", 409)
      }
    })
  } catch (err) {
    if (err instanceof ShoppingHttpError) throw err
    const code = (err as { code?: string }).code
    if (code === "P2002") {
      await classifySkipConflict(params)
      return
    }
    throw err
  }
}

export async function suppressShoppingPostingForTransaction(
  userId: string,
  transactionId: string,
): Promise<boolean> {
  const txn = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { id: true, shoppingPostingId: true, source: true },
  })
  if (!txn?.shoppingPostingId) return false
  await prisma.$transaction([
    prisma.transaction.delete({ where: { id: txn.id } }),
    prisma.shoppingPosting.update({
      where: { id: txn.shoppingPostingId },
      data: { status: "suppressed" },
    }),
  ])
  return true
}

export async function suppressAllShoppingPostingsForUser(userId: string): Promise<void> {
  await prisma.shoppingBudgetPreference.updateMany({
    where: { userId, enabled: true },
    data: { enabled: false, preferenceVersion: { increment: 1 } },
  })
  await prisma.shoppingPosting.updateMany({
    where: { userId, status: { in: ["posted", "needs_attention"] } },
    data: { status: "suppressed" },
  })
}
