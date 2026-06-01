import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import {
  ENVELOPE_FUNDING_BATCH_KIND_MOVE_FUNDS,
  ENVELOPE_FUNDING_BATCH_KIND_REBALANCE,
  isBudgetEnvelope,
  LEDGER_ALLOCATION_PAYEE_LABEL,
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
  TX_SOURCE_ENVELOPE_TRANSFER_IN,
  TX_SOURCE_ENVELOPE_TRANSFER_OUT,
} from "@/lib/constants"
import { ensureSystemSavingsEnvelope } from "@/lib/envelope-funding"
import {
  envelopeBalancesAllTimeBatch,
  savingsEnvelopeBalanceAllTime,
} from "@/lib/envelope-balance-server"
import { encryptFieldForUser } from "@/lib/server-encrypt"

const EMPTY_TAGS = "[]"

export type RebalanceMode = "balanced" | "independent"

export interface RebalanceEntry {
  envelopeId: string
  deltaUsd: number
}

/** @deprecated Use RebalanceMode */
export type MoveFundsMode = RebalanceMode

/** @deprecated Use RebalanceEntry */
export type MoveFundsEntry = RebalanceEntry

async function createTransferLeg(
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    envelopeId: string
    date: Date
    amount: number
    type: "expense" | "credit"
    payeeCipher: string
    source: string
    fundingBatchId: string
    btcPrice: number | null
  },
): Promise<void> {
  const { amount } = params
  if (!Number.isFinite(amount) || amount <= 0) return
  await tx.transaction.create({
    data: {
      userId: params.userId,
      envelopeId: params.envelopeId,
      date: params.date,
      payee: params.payeeCipher,
      amount,
      type: params.type,
      tags: EMPTY_TAGS,
      source: params.source,
      satsAmount: params.btcPrice != null ? usdToSats(amount, params.btcPrice) : null,
      excludeFromMainHistory: false,
      fundingBatchId: params.fundingBatchId,
    },
  })
}

function resolveBatchKind(kind?: string): string {
  if (kind === ENVELOPE_FUNDING_BATCH_KIND_MOVE_FUNDS) return ENVELOPE_FUNDING_BATCH_KIND_MOVE_FUNDS
  return ENVELOPE_FUNDING_BATCH_KIND_REBALANCE
}

async function validateRebalanceBalances(
  userId: string,
  savingsEnvelopeId: string,
  resolved: readonly { envelopeId: string; deltaUsd: number }[],
  mode: RebalanceMode,
): Promise<boolean> {
  if (mode === "balanced") {
    const negatives = resolved.filter((e) => e.deltaUsd < 0)
    if (negatives.length === 0) return true
    const balances = await envelopeBalancesAllTimeBatch(
      userId,
      negatives.map((e) => e.envelopeId),
    )
    return negatives.every(
      (row) => Math.abs(row.deltaUsd) <= (balances.get(row.envelopeId) ?? 0) + 0.015,
    )
  }

  let savingsDelta = 0
  const debitEnvelopeIds: string[] = []
  for (const row of resolved) {
    if (row.deltaUsd > 0) {
      savingsDelta -= row.deltaUsd
    } else {
      savingsDelta += Math.abs(row.deltaUsd)
      debitEnvelopeIds.push(row.envelopeId)
    }
  }

  const savingsBefore = await savingsEnvelopeBalanceAllTime(userId, savingsEnvelopeId)
  if (savingsBefore + savingsDelta < -0.015) return false

  if (debitEnvelopeIds.length === 0) return true

  const balances = await envelopeBalancesAllTimeBatch(userId, debitEnvelopeIds)
  return resolved.every((row) => {
    if (row.deltaUsd >= 0) return true
    const amt = Math.abs(row.deltaUsd)
    return amt <= (balances.get(row.envelopeId) ?? 0) + 0.015
  })
}

export type CreateRebalanceBatchOptions = {
  periodKey?: string
  runDateUtc?: Date
  config?: Prisma.InputJsonValue
  /** Legacy rows may use move_funds kind until migrated. */
  batchKind?: typeof ENVELOPE_FUNDING_BATCH_KIND_REBALANCE | typeof ENVELOPE_FUNDING_BATCH_KIND_MOVE_FUNDS
}

export async function createRebalanceBatch(
  userId: string,
  entries: readonly RebalanceEntry[],
  mode: RebalanceMode,
  options?: CreateRebalanceBatchOptions,
): Promise<number> {
  if (entries.length === 0) return 0

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true },
  })
  const pk = user?.publicKey?.trim()
  if (!pk) return 0

  const savings = await ensureSystemSavingsEnvelope(userId)
  const envelopeIds = [...new Set(entries.map((e) => e.envelopeId))]

  const envelopeRows = await prisma.envelope.findMany({
    where: {
      userId,
      id: { in: envelopeIds },
      archived: false,
      OR: [{ systemRole: null }, { systemRole: { not: SYSTEM_ENVELOPE_ROLE_SAVINGS } }],
    },
    select: { id: true, systemRole: true },
  })
  const allowed = new Set(
    envelopeRows.filter((e) => isBudgetEnvelope(e.systemRole)).map((e) => e.id),
  )

  const resolved = entries
    .filter((e) => allowed.has(e.envelopeId) && Number.isFinite(e.deltaUsd) && e.deltaUsd !== 0)
    .map((e) => ({ envelopeId: e.envelopeId, deltaUsd: Math.round(e.deltaUsd * 100) / 100 }))

  if (resolved.length === 0) return 0

  if (!(await validateRebalanceBalances(userId, savings.id, resolved, mode))) {
    return 0
  }

  const runAt = options?.runDateUtc ?? new Date()
  const dateStr = runAt.toISOString().split("T")[0]!
  const btcPrice = await getBtcPriceForDate(dateStr)
  const moveDate = new Date(`${dateStr}T12:00:00.000Z`)
  const periodKey = options?.periodKey?.trim() || `rebalance-${randomUUID()}`
  const batchKind = resolveBatchKind(options?.batchKind)

  const encTransfer = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, pk)
  if (!encTransfer) return 0

  return prisma.$transaction(async (tx) => {
    const existing = await tx.envelopeFundingBatch.findUnique({
      where: {
        userId_periodKey_kind: {
          userId,
          periodKey,
          kind: batchKind,
        },
      },
    })
    if (existing) return 0

    const batch = await tx.envelopeFundingBatch.create({
      data: {
        userId,
        periodKey,
        kind: batchKind,
        config: options?.config ?? undefined,
      },
    })

    let created = 0

    if (mode === "balanced") {
      const positives = resolved.filter((e) => e.deltaUsd > 0).map((e) => ({ ...e }))
      const negatives = resolved.filter((e) => e.deltaUsd < 0).map((e) => ({ ...e }))

      let posIdx = 0
      let negIdx = 0

      while (posIdx < positives.length && negIdx < negatives.length) {
        const pos = positives[posIdx]!
        const neg = negatives[negIdx]!
        if (pos.deltaUsd <= 0.005) {
          posIdx++
          continue
        }
        if (neg.deltaUsd >= -0.005) {
          negIdx++
          continue
        }
        const amt = Math.min(pos.deltaUsd, Math.abs(neg.deltaUsd))
        if (amt <= 0) {
          posIdx++
          negIdx++
          continue
        }

        await createTransferLeg(tx, {
          userId,
          envelopeId: neg.envelopeId,
          date: moveDate,
          amount: amt,
          type: "expense",
          payeeCipher: encTransfer,
          source: TX_SOURCE_ENVELOPE_TRANSFER_OUT,
          fundingBatchId: batch.id,
          btcPrice,
        })
        await createTransferLeg(tx, {
          userId,
          envelopeId: pos.envelopeId,
          date: moveDate,
          amount: amt,
          type: "credit",
          payeeCipher: encTransfer,
          source: TX_SOURCE_ENVELOPE_TRANSFER_IN,
          fundingBatchId: batch.id,
          btcPrice,
        })
        created += 2

        pos.deltaUsd = Math.round((pos.deltaUsd - amt) * 100) / 100
        neg.deltaUsd = Math.round((neg.deltaUsd + amt) * 100) / 100
        if (pos.deltaUsd <= 0.005) posIdx++
        if (Math.abs(neg.deltaUsd) <= 0.005) negIdx++
      }
      return created
    }

    for (const row of resolved) {
      if (row.deltaUsd > 0) {
        await createTransferLeg(tx, {
          userId,
          envelopeId: savings.id,
          date: moveDate,
          amount: row.deltaUsd,
          type: "expense",
          payeeCipher: encTransfer,
          source: TX_SOURCE_ENVELOPE_TRANSFER_OUT,
          fundingBatchId: batch.id,
          btcPrice,
        })
        await createTransferLeg(tx, {
          userId,
          envelopeId: row.envelopeId,
          date: moveDate,
          amount: row.deltaUsd,
          type: "credit",
          payeeCipher: encTransfer,
          source: TX_SOURCE_ENVELOPE_TRANSFER_IN,
          fundingBatchId: batch.id,
          btcPrice,
        })
        created += 2
      } else {
        const amt = Math.abs(row.deltaUsd)
        await createTransferLeg(tx, {
          userId,
          envelopeId: row.envelopeId,
          date: moveDate,
          amount: amt,
          type: "expense",
          payeeCipher: encTransfer,
          source: TX_SOURCE_ENVELOPE_TRANSFER_OUT,
          fundingBatchId: batch.id,
          btcPrice,
        })
        await createTransferLeg(tx, {
          userId,
          envelopeId: savings.id,
          date: moveDate,
          amount: amt,
          type: "credit",
          payeeCipher: encTransfer,
          source: TX_SOURCE_ENVELOPE_TRANSFER_IN,
          fundingBatchId: batch.id,
          btcPrice,
        })
        created += 2
      }
    }

    return created
  })
}

/** @deprecated Use createRebalanceBatch */
export const createMoveFundsBatch = createRebalanceBatch
