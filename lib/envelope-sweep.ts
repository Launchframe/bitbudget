import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import {
  DEFICIT_COVER_FROM_SAVINGS_LABEL,
  ENVELOPE_FUNDING_BATCH_KIND_DEFICIT_COVER,
  ENVELOPE_FUNDING_BATCH_KIND_SWEEP,
  isBudgetEnvelope,
  SWEEP_POLICY_RESET,
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
  TX_SOURCE_DEFICIT_COVER,
  TX_SOURCE_ENVELOPE_SWEEP,
} from "@/lib/constants"
import { deficitCoverAmount } from "@/lib/budget-period"
import {
  envelopeBalancesAllTimeBatch,
  envelopeBalancesForMonthBatch,
  monthKeyFromDate,
  savingsEnvelopeBalanceAllTime,
} from "@/lib/envelope-balance-server"
import { ensureSystemSavingsEnvelope } from "@/lib/envelope-funding"
import { isBudgetAllocationDay, sweepBatchPeriodKey } from "@/lib/budget-period"
import { isDailyCadenceBlocked } from "@/lib/pay-cadence-server"
import { encryptFieldForUser } from "@/lib/server-encrypt"
import {
  resolveSweepCapMultiplier,
  sweepAmountForEnvelope,
} from "@/lib/sweep-math"

export {
  monthProgressMarkerPct,
  targetBalanceForMonthPace,
  resolveEffectiveSweepPolicy,
  suggestedManualSweepAmount,
  resolveSweepCapMultiplier,
  sweepAmountForEnvelope,
} from "@/lib/sweep-math"

export const SWEEP_TO_SAVINGS_LABEL = "Swept to Savings"

export function sweepFromLabel(envelopeName: string): string {
  return `Swept from ${envelopeName}`
}

const EMPTY_TAGS = "[]"

export async function lockEnvelopeRowsForSweepBalance(
  tx: Prisma.TransactionClient,
  userId: string,
  envelopeIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(envelopeIds)].sort()
  if (ids.length === 0) return

  await tx.$queryRaw`
    SELECT "id"
    FROM "Envelope"
    WHERE "userId" = ${userId}
      AND "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `
}

/**
 * Auto-sweep discretionary envelope leftovers to Savings on UTC calendar 1st.
 * Returns number of visible transactions created (0 if skipped).
 */
export async function sweepDiscretionaryEnvelopesForUser(
  userId: string,
  runDateUtc?: Date,
): Promise<number> {
  const now = runDateUtc ?? new Date()
  if (!isBudgetAllocationDay(now)) return 0

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      publicKey: true,
      payCadence: true,
      sweepDefaultPolicy: true,
      sweepDefaultCapMultiplier: true,
    },
  })
  if (!user?.publicKey?.trim()) return 0
  if (isDailyCadenceBlocked(user.payCadence)) return 0

  const periodKey = sweepBatchPeriodKey(now)

  const savings = await ensureSystemSavingsEnvelope(userId)

  const envelopeRows = await prisma.envelope.findMany({
    where: {
      userId,
      archived: false,
      OR: [{ systemRole: null }, { systemRole: { not: SYSTEM_ENVELOPE_ROLE_SAVINGS } }],
    },
    select: {
      id: true,
      name: true,
      monthlyAllotment: true,
      systemRole: true,
      sweepPolicy: true,
      sweepCapMultiplier: true,
    },
  })

  const budgetRows = envelopeRows.filter((env) => isBudgetEnvelope(env.systemRole))
  if (budgetRows.length === 0) return 0

  const dateStr = now.toISOString().split("T")[0]!
  const btcPrice = await getBtcPriceForDate(dateStr)
  const sweepDate = new Date(`${dateStr}T12:00:00.000Z`)
  const pk = user.publicKey.trim()

  return prisma.$transaction(async (tx) => {
    const dup = await tx.envelopeFundingBatch.findUnique({
      where: {
        userId_periodKey_kind: {
          userId,
          periodKey,
          kind: ENVELOPE_FUNDING_BATCH_KIND_SWEEP,
        },
      },
    })
    if (dup) return 0

    const budgetEnvelopeIds = budgetRows.map((env) => env.id)
    // Serialize sweep balance reads for these envelopes so concurrent sweep
    // requests cannot both spend the same remaining balance.
    await lockEnvelopeRowsForSweepBalance(tx, userId, budgetEnvelopeIds)

    const balances = await envelopeBalancesAllTimeBatch(
      userId,
      budgetEnvelopeIds,
      tx,
    )

    type SweepEntry = { envelopeId: string; name: string; amount: number }
    const entries: SweepEntry[] = []

    for (const env of budgetRows) {
      const balance = balances.get(env.id) ?? 0
      const policy = env.sweepPolicy || user.sweepDefaultPolicy || SWEEP_POLICY_RESET
      const capMult = resolveSweepCapMultiplier(env.sweepCapMultiplier, user.sweepDefaultCapMultiplier)
      const amount = sweepAmountForEnvelope({
        balance,
        policy,
        monthlyAllotment: env.monthlyAllotment,
        capMultiplier: capMult,
      })
      if (amount > 0) entries.push({ envelopeId: env.id, name: env.name, amount })
    }

    // Exit before creating the batch when there is nothing to sweep.
    // This leaves the period key unwritten so a later cron run can retry
    // (e.g. if income hasn't posted yet and envelopes are still empty).
    if (entries.length === 0) return 0

    let batch
    try {
      batch = await tx.envelopeFundingBatch.create({
        data: {
          userId,
          periodKey,
          kind: ENVELOPE_FUNDING_BATCH_KIND_SWEEP,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return 0
      }
      throw e
    }

    let created = 0
    for (const entry of entries) {
      const encOut = encryptFieldForUser(SWEEP_TO_SAVINGS_LABEL, pk)
      const encIn = encryptFieldForUser(sweepFromLabel(entry.name), pk)
      if (!encOut || !encIn) continue

      const satsAmount = btcPrice ? usdToSats(entry.amount, btcPrice) : null

      await tx.transaction.create({
        data: {
          userId,
          envelopeId: entry.envelopeId,
          date: sweepDate,
          payee: encOut,
          amount: entry.amount,
          type: "expense",
          tags: EMPTY_TAGS,
          source: TX_SOURCE_ENVELOPE_SWEEP,
          satsAmount,
          excludeFromMainHistory: false,
          fundingBatchId: batch.id,
        },
      })
      await tx.transaction.create({
        data: {
          userId,
          envelopeId: savings.id,
          date: sweepDate,
          payee: encIn,
          amount: entry.amount,
          type: "credit",
          tags: EMPTY_TAGS,
          source: TX_SOURCE_ENVELOPE_SWEEP,
          satsAmount,
          excludeFromMainHistory: false,
          fundingBatchId: batch.id,
        },
      })
      created += 2
    }

    return created
  })
}

export interface ManualSweepEntry {
  envelopeId: string
  amount: number
}

async function createSweepLegsForBatch(
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    savingsId: string
    entries: Array<{ envelopeId: string; name: string; amount: number }>
    sweepDate: Date
    btcPrice: number | null
    pk: string
    batchId: string
  },
): Promise<number> {
  let created = 0
  for (const entry of params.entries) {
    const encOut = encryptFieldForUser(SWEEP_TO_SAVINGS_LABEL, params.pk)
    const encIn = encryptFieldForUser(sweepFromLabel(entry.name), params.pk)
    if (!encOut || !encIn) continue

    const satsAmount = params.btcPrice ? usdToSats(entry.amount, params.btcPrice) : null

    await tx.transaction.create({
      data: {
        userId: params.userId,
        envelopeId: entry.envelopeId,
        date: params.sweepDate,
        payee: encOut,
        amount: entry.amount,
        type: "expense",
        tags: EMPTY_TAGS,
        source: TX_SOURCE_ENVELOPE_SWEEP,
        satsAmount,
        excludeFromMainHistory: false,
        fundingBatchId: params.batchId,
      },
    })
    await tx.transaction.create({
      data: {
        userId: params.userId,
        envelopeId: params.savingsId,
        date: params.sweepDate,
        payee: encIn,
        amount: entry.amount,
        type: "credit",
        tags: EMPTY_TAGS,
        source: TX_SOURCE_ENVELOPE_SWEEP,
        satsAmount,
        excludeFromMainHistory: false,
        fundingBatchId: params.batchId,
      },
    })
    created += 2
  }
  return created
}

/**
 * User-initiated sweep from selected envelopes to Savings.
 * Returns number of visible transactions created (0 if skipped).
 */
export async function createManualEnvelopeSweep(
  userId: string,
  rawEntries: ManualSweepEntry[],
  runDateUtc?: Date,
): Promise<number> {
  const now = runDateUtc ?? new Date()
  const entries = rawEntries
    .map((e) => ({
      envelopeId: e.envelopeId,
      amount: Math.round(e.amount * 100) / 100,
    }))
    .filter((e) => Number.isFinite(e.amount) && e.amount > 0)

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
    select: { id: true, name: true, systemRole: true },
  })
  const envelopeById = new Map(envelopeRows.map((e) => [e.id, e]))

  const validEntries = entries.filter((entry) => {
    const env = envelopeById.get(entry.envelopeId)
    return env != null && isBudgetEnvelope(env.systemRole)
  })

  if (validEntries.length === 0) return 0

  const dateStr = now.toISOString().split("T")[0]!
  const btcPrice = await getBtcPriceForDate(dateStr)
  const sweepDate = new Date(`${dateStr}T12:00:00.000Z`)
  const periodKey = `manual-sweep-${randomUUID()}`

  return prisma.$transaction(async (tx) => {
    const validEnvelopeIds = validEntries.map((e) => e.envelopeId)
    await lockEnvelopeRowsForSweepBalance(tx, userId, validEnvelopeIds)

    const balances = await envelopeBalancesAllTimeBatch(
      userId,
      validEnvelopeIds,
      tx,
    )

    type ResolvedEntry = { envelopeId: string; name: string; amount: number }
    const resolved: ResolvedEntry[] = []

    for (const entry of validEntries) {
      const env = envelopeById.get(entry.envelopeId)!
      const balance = balances.get(entry.envelopeId) ?? 0
      const amount = Math.min(entry.amount, Math.max(0, balance))
      if (amount <= 0) continue
      resolved.push({ envelopeId: entry.envelopeId, name: env.name, amount })
    }

    if (resolved.length === 0) return 0

    const batch = await tx.envelopeFundingBatch.create({
      data: {
        userId,
        periodKey,
        kind: ENVELOPE_FUNDING_BATCH_KIND_SWEEP,
      },
    })

    return createSweepLegsForBatch(tx, {
      userId,
      savingsId: savings.id,
      entries: resolved,
      sweepDate,
      btcPrice,
      pk,
      batchId: batch.id,
    })
  })
}

export interface ManualDeficitCoverEntry {
  envelopeId: string
  amount: number
}

/**
 * Manual Savings → envelope cover (month balance toward $0 only).
 */
export async function createManualDeficitCover(
  userId: string,
  rawEntries: ManualDeficitCoverEntry[],
  runDateUtc?: Date,
): Promise<number> {
  const now = runDateUtc ?? new Date()
  const monthKey = monthKeyFromDate(now)

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true },
  })
  const pk = user?.publicKey?.trim()
  if (!pk) return 0

  const savings = await ensureSystemSavingsEnvelope(userId)
  const entries = rawEntries
    .map((e) => ({
      envelopeId: e.envelopeId,
      amount: Math.round(e.amount * 100) / 100,
    }))
    .filter((e) => Number.isFinite(e.amount) && e.amount > 0)

  if (entries.length === 0) return 0

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

  type Resolved = { envelopeId: string; amount: number }
  const resolved: Resolved[] = []
  let totalCover = 0

  const candidateIds = entries
    .map((e) => e.envelopeId)
    .filter((id) => allowed.has(id))
  const monthBalances = await envelopeBalancesForMonthBatch(userId, candidateIds, monthKey)

  for (const entry of entries) {
    if (!allowed.has(entry.envelopeId)) continue
    const monthBal = monthBalances.get(entry.envelopeId) ?? 0
    if (monthBal >= 0) continue
    const maxCover = deficitCoverAmount(monthBal)
    const amount = Math.min(entry.amount, maxCover)
    if (amount <= 0) continue
    resolved.push({ envelopeId: entry.envelopeId, amount })
    totalCover += amount
  }

  if (resolved.length === 0) return 0

  const savingsBalance = await savingsEnvelopeBalanceAllTime(userId, savings.id)
  if (totalCover > savingsBalance + 0.015) return 0

  const dateStr = now.toISOString().split("T")[0]!
  const btcPrice = await getBtcPriceForDate(dateStr)
  const coverDate = new Date(`${dateStr}T12:00:00.000Z`)
  const periodKey = `deficit-cover-${randomUUID()}`

  const encOut = encryptFieldForUser(DEFICIT_COVER_FROM_SAVINGS_LABEL, pk)
  const encIn = encryptFieldForUser(DEFICIT_COVER_FROM_SAVINGS_LABEL, pk)
  if (!encOut || !encIn) return 0

  return prisma.$transaction(async (tx) => {
    const batch = await tx.envelopeFundingBatch.create({
      data: {
        userId,
        periodKey,
        kind: ENVELOPE_FUNDING_BATCH_KIND_DEFICIT_COVER,
      },
    })

    let created = 0
    for (const row of resolved) {
      const satsAmount = btcPrice ? usdToSats(row.amount, btcPrice) : null
      await tx.transaction.create({
        data: {
          userId,
          envelopeId: savings.id,
          date: coverDate,
          payee: encOut,
          amount: row.amount,
          type: "expense",
          tags: "[]",
          source: TX_SOURCE_DEFICIT_COVER,
          satsAmount,
          excludeFromMainHistory: false,
          fundingBatchId: batch.id,
        },
      })
      await tx.transaction.create({
        data: {
          userId,
          envelopeId: row.envelopeId,
          date: coverDate,
          payee: encIn,
          amount: row.amount,
          type: "credit",
          tags: "[]",
          source: TX_SOURCE_DEFICIT_COVER,
          satsAmount,
          excludeFromMainHistory: false,
          fundingBatchId: batch.id,
        },
      })
      created += 2
    }
    return created
  })
}
