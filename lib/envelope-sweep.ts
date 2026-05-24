import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import {
  ENVELOPE_FUNDING_BATCH_KIND_SWEEP,
  isBudgetEnvelope,
  SWEEP_POLICY_CAPPED,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_RESET,
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
  TX_SOURCE_ENVELOPE_SWEEP,
} from "@/lib/constants"
import { envelopeBalanceForMonth, monthKeyFromDate } from "@/lib/envelope-balance-server"
import { ensureSystemSavingsEnvelope } from "@/lib/envelope-funding"
import { fundingPeriodKeyForDate } from "@/lib/envelope-funding-period"
import { isDailyPayCadenceAllowed } from "@/lib/pay-cadence-server"
import {
  isPaydayForUser,
  sweepPeriodKeyForPayday,
  usesPaydayCadence,
  type PaydayUserFields,
} from "@/lib/payday-cadence"
import { encryptFieldForUser } from "@/lib/server-encrypt"

export const SWEEP_TO_SAVINGS_LABEL = "Swept to Savings"

export function sweepFromLabel(envelopeName: string): string {
  return `Swept from ${envelopeName}`
}

const DEFAULT_CAP_MULTIPLIER = 1.5
const EMPTY_TAGS = "[]"

export function resolveSweepCapMultiplier(
  envelopeCap: Prisma.Decimal | null | undefined,
  userDefaultCap: Prisma.Decimal | null | undefined,
): number {
  if (envelopeCap != null) return Number(envelopeCap)
  if (userDefaultCap != null) return Number(userDefaultCap)
  return DEFAULT_CAP_MULTIPLIER
}

/** Pure sweep amount for one discretionary envelope. */
export function sweepAmountForEnvelope(params: {
  balance: number
  policy: string
  monthlyAllotment: number
  capMultiplier: number
}): number {
  const { balance, policy, monthlyAllotment, capMultiplier } = params
  if (!Number.isFinite(balance) || balance <= 0) return 0

  if (policy === SWEEP_POLICY_CARRY_FORWARD) return 0

  if (policy === SWEEP_POLICY_CAPPED) {
    const cap = capMultiplier * monthlyAllotment
    const amount = Math.max(0, balance - cap)
    return Math.round(amount * 100) / 100
  }

  if (policy === SWEEP_POLICY_RESET) {
    return Math.round(balance * 100) / 100
  }

  return 0
}

function sweepPeriodKeyForUser(user: PaydayUserFields, runDateUtc: Date): string | null {
  if (usesPaydayCadence(user)) {
    if (!isPaydayForUser(user, runDateUtc)) return null
    return sweepPeriodKeyForPayday(user, runDateUtc)
  }
  const fundKey = fundingPeriodKeyForDate({
    payCadence: user.payCadence,
    runDateUtc,
    dailyCadenceAllowed: isDailyPayCadenceAllowed(),
  })
  return fundKey ? `sweep-${fundKey}` : null
}

/**
 * Sweep discretionary envelope leftovers to Savings on payday.
 * Returns number of visible transactions created (0 if skipped).
 */
export async function sweepDiscretionaryEnvelopesForUser(
  userId: string,
  runDateUtc?: Date,
): Promise<number> {
  const now = runDateUtc ?? new Date()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      publicKey: true,
      payCadence: true,
      payDays: true,
      payDayOfWeek: true,
      lastPaydayAt: true,
      sweepDefaultPolicy: true,
      sweepDefaultCapMultiplier: true,
    },
  })
  if (!user?.publicKey?.trim()) return 0

  const paydayUser: PaydayUserFields = {
    payCadence: user.payCadence,
    payDays: user.payDays,
    payDayOfWeek: user.payDayOfWeek,
    lastPaydayAt: user.lastPaydayAt,
  }

  const periodKey = sweepPeriodKeyForUser(paydayUser, now)
  if (!periodKey) return 0

  const savings = await ensureSystemSavingsEnvelope(userId)
  const monthKey = monthKeyFromDate(now)

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

  type SweepEntry = { envelopeId: string; name: string; amount: number }
  const entries: SweepEntry[] = []

  for (const env of envelopeRows) {
    if (!isBudgetEnvelope(env.systemRole)) continue
    const balance = await envelopeBalanceForMonth(userId, env.id, monthKey)
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

  if (entries.length === 0) return 0

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
  const monthKey = monthKeyFromDate(now)

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

  type ResolvedEntry = { envelopeId: string; name: string; amount: number }
  const resolved: ResolvedEntry[] = []

  for (const entry of entries) {
    const env = envelopeById.get(entry.envelopeId)
    if (!env || !isBudgetEnvelope(env.systemRole)) continue
    const balance = await envelopeBalanceForMonth(userId, entry.envelopeId, monthKey)
    const amount = Math.min(entry.amount, Math.max(0, balance))
    if (amount <= 0) continue
    resolved.push({ envelopeId: entry.envelopeId, name: env.name, amount })
  }

  if (resolved.length === 0) return 0

  const dateStr = now.toISOString().split("T")[0]!
  const btcPrice = await getBtcPriceForDate(dateStr)
  const sweepDate = new Date(`${dateStr}T12:00:00.000Z`)
  const periodKey = `manual-sweep-${randomUUID()}`

  return prisma.$transaction(async (tx) => {
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
