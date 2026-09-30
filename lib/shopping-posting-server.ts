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
import { kindToTransactionSource } from "@/lib/shopping-budget-projection"

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
  const me = await requireActiveMember(params.groupId, params.userId)
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

    const envelope = await prisma.envelope.findFirst({
      where: { id: entry.envelopeId, userId: params.userId, deletedAt: null },
    })
    if (!envelope) {
      await prisma.shoppingPosting.upsert({
        where: {
          userId_eventId_entryKey: {
            userId: params.userId,
            eventId: params.eventId,
            entryKey: entry.entryKey,
          },
        },
        update: { status: "needs_attention", projectionRevision: params.projectionRevision },
        create: {
          userId: params.userId,
          groupId: params.groupId,
          eventId: params.eventId,
          entryKey: entry.entryKey,
          projectionRevision: params.projectionRevision,
          status: "needs_attention",
        },
      })
      needsAttention.push(entry.entryKey)
      continue
    }

    const amount = centsToDollars(entry.cents)
    const dateStr = entry.postedOn
    const btcPrice = await getBtcPriceForDate(dateStr)

    try {
      const result = await prisma.$transaction(async (tx) => {
        const posting = await tx.shoppingPosting.upsert({
          where: {
            userId_eventId_entryKey: {
              userId: params.userId,
              eventId: params.eventId,
              entryKey: entry.entryKey,
            },
          },
          update: { projectionRevision: params.projectionRevision, status: "posted" },
          create: {
            userId: params.userId,
            groupId: params.groupId,
            eventId: params.eventId,
            entryKey: entry.entryKey,
            projectionRevision: params.projectionRevision,
            status: "posted",
          },
        })
        const already = await tx.transaction.findFirst({
          where: { shoppingPostingId: posting.id, userId: params.userId },
        })
        if (already) return already.id
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
            shoppingPostingId: posting.id,
            satsAmount: btcPrice ? usdToSats(amount, btcPrice) : null,
          },
        })
        return created.id
      })
      createdIds.push(result)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === "P2002") {
        const posted = await prisma.transaction.findFirst({
          where: { userId: params.userId, shoppingPosting: { entryKey: entry.entryKey, eventId: params.eventId } },
          select: { id: true },
        })
        if (posted) createdIds.push(posted.id)
        else skipped.push(entry.entryKey)
        continue
      }
      throw err
    }
  }

  void me
  return { createdIds, skipped, needsAttention }
}

export async function skipShoppingPosting(params: {
  userId: string
  groupId: string
  eventId: string
  entryKey: string
  preferenceVersion: number
}): Promise<void> {
  await requireActiveMember(params.groupId, params.userId)
  const pref = await prisma.shoppingBudgetPreference.findFirst({
    where: { groupId: params.groupId, userId: params.userId },
  })
  if (!pref || pref.preferenceVersion !== params.preferenceVersion) {
    throw new ShoppingHttpError("Budget settings changed on another device. Refresh and try again.", 409)
  }
  await prisma.shoppingPosting.upsert({
    where: {
      userId_eventId_entryKey: {
        userId: params.userId,
        eventId: params.eventId,
        entryKey: params.entryKey,
      },
    },
    update: { status: "skipped" },
    create: {
      userId: params.userId,
      groupId: params.groupId,
      eventId: params.eventId,
      entryKey: params.entryKey,
      projectionRevision: 0,
      status: "skipped",
    },
  })
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
