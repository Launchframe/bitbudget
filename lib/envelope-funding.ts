import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import {
  ENVELOPE_FUNDING_BATCH_KIND_FUND,
  LEDGER_ALLOCATION_PAYEE_LABEL,
  LEDGER_INCOME_PAYEE_LABEL,
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
  TX_SOURCE_FUNDING_IN,
  TX_SOURCE_FUNDING_OUT,
  TX_SOURCE_IRREGULAR_INCOME,
  TX_SOURCE_PAYCHECK,
  TX_SOURCE_RETRO_PAYCHECK,
  isBudgetEnvelope,
} from "@/lib/constants"
import {
  allocationBatchPeriodKey,
  allocationTopUpAmount,
  isBudgetAllocationDay,
  paycheckBatchPeriodKey,
} from "@/lib/budget-period"
import {
  grossIncomeForFundingRun,
  grossIncomeForPaydayUser,
  paydayDomListInUtcMonth,
} from "@/lib/envelope-funding-period"
import {
  envelopeBalancesAllTimeBatch,
  envelopeBalancesForMonthBatch,
  monthKeyFromDate,
  savingsEnvelopeBalanceAllTime,
} from "@/lib/envelope-balance-server"
import type { DistributionBehavior } from "@/lib/rebalance-math"
import { computeDistribution, validateExplicitAllocations } from "@/lib/rebalance-math"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import {
  fundingPeriodKeyForPayday,
  isPaydayForUser,
  usesPaydayCadence,
  type PaydayUserFields,
} from "@/lib/payday-cadence"
import { encryptFieldForUser } from "@/lib/server-encrypt"
import { isDailyCadenceBlocked, isDailyPayCadenceAllowed } from "@/lib/pay-cadence-server"
import {
  computeIrregularIncomeSplits,
  sumAllocatedIrregularCents,
} from "@/lib/irregular-income-split"
import { ensureSystemSavingsEnvelope, savingsEnvelopeForUserDb } from "@/lib/ensure-system-savings-envelope"
import { splitUsdProportionalByAllotment } from "@/lib/allotment-proportional-split"
import { retroMissedPaycheckGrossUsd } from "@/lib/retro-paycheck-proration"

export { ensureSystemSavingsEnvelope } from "@/lib/ensure-system-savings-envelope"

// Re-export for callers that still import sources from this module.
export {
  TX_SOURCE_FUNDING_IN,
  TX_SOURCE_FUNDING_OUT,
  TX_SOURCE_IRREGULAR_INCOME,
  TX_SOURCE_PAYCHECK,
  TX_SOURCE_RETRO_PAYCHECK,
} from "@/lib/constants"

const EMPTY_TAGS = "[]"

function paycheckPeriodKeysForUser(
  user: PaydayUserFields,
  runDateUtc: Date,
): string[] {
  const payKey = paycheckBatchPeriodKey(runDateUtc)
  const legacyKey = fundingPeriodKeyForPayday(user, runDateUtc)
  return legacyKey === payKey ? [payKey] : [payKey, legacyKey]
}

/**
 * Budget envelopes for funding splits. Prisma `NOT: { systemRole: 'savings' }` excludes rows
 * where `systemRole` IS NULL — use an explicit OR so legacy envelopes still receive slices.
 */
function budgetEnvelopeWhere(userId: string): Prisma.EnvelopeWhereInput {
  return {
    userId,
    archived: false,
    OR: [{ systemRole: null }, { systemRole: { not: SYSTEM_ENVELOPE_ROLE_SAVINGS } }],
  }
}

function cents(usd: number): number {
  return Math.round(usd * 100)
}

async function createFundingLeg(
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    envelopeId: string
    date: Date
    amount: number
    type: "expense" | "credit"
    payeeCipher: string | null
    source: string
    excludeFromMainHistory: boolean
    fundingBatchId: string
    btcPrice: number | null
    notesCipher?: string | null
  },
): Promise<void> {
  const { amount } = params
  if (!Number.isFinite(amount) || amount <= 0) return
  const satsAmount =
    params.btcPrice != null ? usdToSats(amount, params.btcPrice) : null

  await tx.transaction.create({
    data: {
      userId: params.userId,
      envelopeId: params.envelopeId,
      date: params.date,
      payee: params.payeeCipher ?? "",
      amount,
      type: params.type,
      tags: EMPTY_TAGS,
      notes: params.notesCipher ?? null,
      source: params.source,
      satsAmount,
      excludeFromMainHistory: params.excludeFromMainHistory,
      fundingBatchId: params.fundingBatchId,
    },
  })
}

/**
 * PayPeriod: credit paycheck slice to Savings only (no allocation legs).
 */
export async function creditPaycheckToSavings(userId: string, runDateUtc?: Date): Promise<number> {
  const now = runDateUtc ?? new Date()
  const dailyAllowed = isDailyPayCadenceAllowed()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      monthlyIncome: true,
      payCadence: true,
      payDays: true,
      payDayOfWeek: true,
      lastPaydayAt: true,
      publicKey: true,
    },
  })

  if (!user?.publicKey?.trim()) return 0

  const paydayUser: PaydayUserFields = {
    payCadence: user.payCadence,
    payDays: user.payDays,
    payDayOfWeek: user.payDayOfWeek,
    lastPaydayAt: user.lastPaydayAt,
  }

  if (isDailyCadenceBlocked(user.payCadence, dailyAllowed)) return 0
  if (!isPaydayForUser(paydayUser, now)) return 0

  const periodKeys = paycheckPeriodKeysForUser(paydayUser, now)
  const periodKey = periodKeys[0]!

  const savings = await savingsEnvelopeForUserDb(prisma, userId)
  if (!savings) return 0

  const paydaysInMonth =
    usesPaydayCadence(paydayUser) && paydayUser.payCadence !== "daily"
      ? paydayDomListInUtcMonth(paydayUser, now.getUTCFullYear(), now.getUTCMonth())
      : undefined

  const gross = usesPaydayCadence(paydayUser)
    ? grossIncomeForPaydayUser(
        user.monthlyIncome,
        paydayUser,
        now,
        dailyAllowed,
        paydaysInMonth,
      )
    : grossIncomeForFundingRun(user.monthlyIncome, user.payCadence, now, dailyAllowed)
  if (!Number.isFinite(gross) || gross <= 0) return 0

  const dateStr = now.toISOString().split("T")[0]!
  const btcPrice = await getBtcPriceForDate(dateStr)
  const encIncome = encryptFieldForUser(LEDGER_INCOME_PAYEE_LABEL, user.publicKey)
  if (!encIncome) return 0

  const fundingDate = new Date(`${dateStr}T12:00:00.000Z`)

  return prisma.$transaction(async (tx) => {
    for (const key of periodKeys) {
      const dup = await tx.envelopeFundingBatch.findUnique({
        where: {
          userId_periodKey_kind: {
            userId,
            periodKey: key,
            kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
          },
        },
      })
      if (dup) return 0
    }

    let batch
    try {
      batch = await tx.envelopeFundingBatch.create({
        data: { userId, periodKey, kind: ENVELOPE_FUNDING_BATCH_KIND_FUND },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return 0
      }
      throw e
    }

    await tx.transaction.create({
      data: {
        userId,
        envelopeId: savings.id,
        date: fundingDate,
        payee: encIncome,
        amount: gross,
        type: "credit",
        tags: EMPTY_TAGS,
        notes: null,
        source: TX_SOURCE_PAYCHECK,
        satsAmount: btcPrice ? usdToSats(gross, btcPrice) : null,
        excludeFromMainHistory: false,
        fundingBatchId: batch.id,
      },
    })

    const legacyKey = periodKeys[1]
    if (legacyKey && legacyKey !== periodKey) {
      try {
        await tx.envelopeFundingBatch.create({
          data: {
            userId,
            periodKey: legacyKey,
            kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
          },
        })
      } catch (e) {
        if (
          !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        ) {
          throw e
        }
      }
    }

    return 1
  })
}

/**
 * BudgetPeriod: gap-only top-up from Savings to discretionary envelopes (UTC 1st).
 */
export async function processMonthlyBudgetAllocations(
  userId: string,
  runDateUtc?: Date,
): Promise<number> {
  const now = runDateUtc ?? new Date()
  if (!isBudgetAllocationDay(now)) return 0

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true },
  })
  if (!user?.publicKey?.trim()) return 0

  const savings = await savingsEnvelopeForUserDb(prisma, userId)
  if (!savings) return 0

  const envelopeRows = await prisma.envelope.findMany({
    where: budgetEnvelopeWhere(userId),
    select: { id: true, monthlyAllotment: true, systemRole: true },
  })
  const envelopes = envelopeRows.filter((e) => isBudgetEnvelope(e.systemRole))
  if (envelopes.length === 0) return 0

  const monthKey = monthKeyFromDate(now)
  const monthBalances = await envelopeBalancesForMonthBatch(
    userId,
    envelopes.map((e) => e.id),
    monthKey,
  )

  type TopUpRow = { id: string; topUp: number }
  const topUps: TopUpRow[] = []
  let sumTopUp = 0
  for (const e of envelopes) {
    const balance = monthBalances.get(e.id) ?? 0
    const topUp = allocationTopUpAmount({
      monthlyAllotment: e.monthlyAllotment,
      currentMonthBalance: balance,
    })
    if (topUp > 0) {
      topUps.push({ id: e.id, topUp })
      sumTopUp += topUp
    }
  }
  if (sumTopUp <= 0) return 0

  const savingsBalance = await savingsEnvelopeBalanceAllTime(userId, savings.id)
  if (sumTopUp > savingsBalance + 0.015) return 0

  const dateStr = now.toISOString().split("T")[0]!
  const btcPrice = await getBtcPriceForDate(dateStr)
  const encAllocOut = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, user.publicKey)
  const encAllocIn = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, user.publicKey)
  if (!encAllocOut || !encAllocIn) return 0

  const fundingDate = new Date(`${dateStr}T12:00:00.000Z`)
  const periodKey = allocationBatchPeriodKey(now)

  return prisma.$transaction(async (tx) => {
    const dup = await tx.envelopeFundingBatch.findUnique({
      where: {
        userId_periodKey_kind: {
          userId,
          periodKey,
          kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
        },
      },
    })
    if (dup) return 0

    let batch
    try {
      batch = await tx.envelopeFundingBatch.create({
        data: { userId, periodKey, kind: ENVELOPE_FUNDING_BATCH_KIND_FUND },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return 0
      }
      throw e
    }

    let created = 0
    for (const row of topUps) {
      await createFundingLeg(tx, {
        userId,
        envelopeId: savings.id,
        date: fundingDate,
        amount: row.topUp,
        type: "expense",
        payeeCipher: encAllocOut,
        source: TX_SOURCE_FUNDING_OUT,
        excludeFromMainHistory: true,
        fundingBatchId: batch.id,
        btcPrice,
      })
      await createFundingLeg(tx, {
        userId,
        envelopeId: row.id,
        date: fundingDate,
        amount: row.topUp,
        type: "credit",
        payeeCipher: encAllocIn,
        source: TX_SOURCE_FUNDING_IN,
        excludeFromMainHistory: true,
        fundingBatchId: batch.id,
        btcPrice,
      })
      created += 2
    }

    return created
  })
}

/** @deprecated Use creditPaycheckToSavings for paydays only. */
export async function processEnvelopeFundingForUser(userId: string, runDateUtc?: Date): Promise<number> {
  return creditPaycheckToSavings(userId, runDateUtc)
}

/** Process ledger funding for every user with encryption keys configured. */
export async function processAllEnvelopeFunding(asOf?: Date): Promise<number> {
  const users = await prisma.user.findMany({
    where: {
      publicKey: { not: null },
      NOT: { publicKey: "" },
    },
    select: { id: true },
  })
  let total = 0
  for (const u of users) {
    total += await processEnvelopeFundingForUser(u.id, asOf)
  }
  return total
}

export type IrregularDistributionMode = "savings" | "envelopes" | "legacy_auto"

export interface IrregularEnvelopeAllocation {
  envelopeId: string
  amountUsd: number
}

export interface IrregularIncomeInput {
  userId: string
  publicKey: string | null
  grossUsd: number
  /** ISO calendar date YYYY-MM-DD */
  dateIso: string
  /** Plaintext payer description — encrypted before storage */
  displayPayee: string
  notesPlain?: string | null
  /** When set, skips reloading `User.monthlyIncome` from the database. */
  userIncome?: { monthlyIncome: number }
  distributionMode?: IrregularDistributionMode
  distributionBehavior?: DistributionBehavior
  fundOverageFromSavings?: boolean
  envelopeAllocations?: IrregularEnvelopeAllocation[]
  /** Snapshot stored on EnvelopeFundingBatch.config for edit/history. */
  batchConfig?: Record<string, unknown>
}

async function resolveIrregularEnvelopeAmounts(
  input: IrregularIncomeInput,
  savingsId: string,
  gross: number,
  mi: number,
): Promise<Map<string, number> | null> {
  const mode = input.distributionMode ?? "savings"

  if (mode === "savings") {
    return new Map()
  }

  const envelopeRows = await prisma.envelope.findMany({
    where: budgetEnvelopeWhere(input.userId),
    select: { id: true, monthlyAllotment: true, systemRole: true },
  })
  const envelopes = envelopeRows.filter((e) => isBudgetEnvelope(e.systemRole))

  if (mode === "legacy_auto") {
    let sumAllot = 0
    for (const e of envelopes) {
      const a = e.monthlyAllotment
      if (Number.isFinite(a) && a > 0) sumAllot += a
    }
    if (sumAllot > mi + 0.015) return null

    const split = computeIrregularIncomeSplits({
      grossUsd: gross,
      monthlyIncome: mi,
      envelopes,
      excludeEnvelopeIds: new Set([savingsId]),
    })
    if (split.invalid) return null
    const grossCents = cents(gross)
    const allocated = sumAllocatedIrregularCents(split)
    if (allocated > grossCents + 1) return null
    if (sumAllot > 0 && allocated <= 0) return null

    const out = new Map<string, number>()
    for (const [envId, allocCents] of split.envelopeIdToCents) {
      const amt = allocCents / 100
      if (amt > 0) out.set(envId, amt)
    }
    return out
  }

  if (input.envelopeAllocations && input.envelopeAllocations.length > 0) {
    if (!validateExplicitAllocations(gross, input.envelopeAllocations)) return null
    const out = new Map<string, number>()
    const allowed = new Set(envelopes.map((e) => e.id))
    for (const row of input.envelopeAllocations) {
      if (!allowed.has(row.envelopeId)) return null
      if (row.amountUsd > 0) out.set(row.envelopeId, row.amountUsd)
    }
    return out
  }

  const behavior = input.distributionBehavior
  if (!behavior) return null

  // Use all-time balance (credits minus expenses over the envelope's lifetime, including
  // prior-month carryover) so that set_to_budget correctly computes gap = allotment − remaining.
  // Month-scoped balance is negative after carry-forward users spend in the current period,
  // causing the gap to be overstated and the income to be over-drained into envelopes.
  const allTimeBalances = await envelopeBalancesAllTimeBatch(
    input.userId,
    envelopes.map((e) => e.id),
  )
  const savingsBalance = await savingsEnvelopeBalanceAllTime(input.userId, savingsId)

  const dist = computeDistribution({
    behavior,
    envelopes: envelopes.map((e) => ({
      id: e.id,
      monthlyAllotment: e.monthlyAllotment,
      currentMonthBalance: allTimeBalances.get(e.id) ?? 0,
    })),
    grossUsd: gross,
    savingsBalance,
    fundOverageFromSavings: input.fundOverageFromSavings === true,
  })
  if (dist.invalid) return null

  const out = new Map<string, number>()
  for (const line of dist.lines) {
    if (line.deltaUsd > 0) out.set(line.envelopeId, line.deltaUsd)
  }
  return out
}

/** Manual irregular income: Savings credit; optional user-chosen envelope legs. */
export async function createIrregularIncomeBatch(input: IrregularIncomeInput): Promise<number> {
  const pk = input.publicKey?.trim()
  if (!pk) return 0

  const gross = input.grossUsd
  if (!Number.isFinite(gross) || gross <= 0) return 0

  const user =
    input.userIncome ??
    (await prisma.user.findUnique({
      where: { id: input.userId },
      select: { monthlyIncome: true },
    }))
  if (!user) return 0

  const mi = user.monthlyIncome
  if (!Number.isFinite(mi) || mi <= 0) return 0

  const savings = await ensureSystemSavingsEnvelope(input.userId)

  const envelopeAmounts = await resolveIrregularEnvelopeAmounts(
    input,
    savings.id,
    gross,
    mi,
  )
  if (envelopeAmounts === null) return 0

  let allocatedSum = 0
  for (const amt of envelopeAmounts.values()) allocatedSum += amt
  if (allocatedSum > gross + 0.015) return 0

  const dateStr = input.dateIso
  const btcPrice = await getBtcPriceForDate(dateStr)
  const fundingDate = new Date(`${dateStr}T12:00:00.000Z`)

  const encIncomePayee = encryptFieldForUser(input.displayPayee.trim(), pk)
  if (!encIncomePayee) return 0

  const encNotes =
    input.notesPlain?.trim() ? encryptFieldForUser(input.notesPlain.trim(), pk) : null

  const needsLegs = envelopeAmounts.size > 0
  let encAllocOut: string | null = null
  let encAllocIn: string | null = null
  if (needsLegs) {
    encAllocOut = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, pk)
    encAllocIn = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, pk)
    if (!encAllocOut || !encAllocIn) return 0
  }

  const periodKey = `irr-${randomUUID()}`
  let created = 0

  await prisma.$transaction(async (tx) => {
    const batch = await tx.envelopeFundingBatch.create({
      data: {
        userId: input.userId,
        periodKey,
        kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
        ...(input.batchConfig ? { config: input.batchConfig as object } : {}),
      },
    })

    await tx.transaction.create({
      data: {
        userId: input.userId,
        envelopeId: savings.id,
        date: fundingDate,
        payee: encIncomePayee,
        amount: gross,
        type: "credit",
        tags: EMPTY_TAGS,
        notes: encNotes,
        source: TX_SOURCE_IRREGULAR_INCOME,
        satsAmount: btcPrice ? usdToSats(gross, btcPrice) : null,
        excludeFromMainHistory: false,
        fundingBatchId: batch.id,
      },
    })
    created++

    for (const [envId, amt] of envelopeAmounts) {
      if (amt <= 0) continue

      await createFundingLeg(tx, {
        userId: input.userId,
        envelopeId: savings.id,
        date: fundingDate,
        amount: amt,
        type: "expense",
        payeeCipher: encAllocOut,
        source: TX_SOURCE_FUNDING_OUT,
        excludeFromMainHistory: true,
        fundingBatchId: batch.id,
        btcPrice,
      })
      await createFundingLeg(tx, {
        userId: input.userId,
        envelopeId: envId,
        date: fundingDate,
        amount: amt,
        type: "credit",
        payeeCipher: encAllocIn,
        source: TX_SOURCE_FUNDING_IN,
        excludeFromMainHistory: true,
        fundingBatchId: batch.id,
        btcPrice,
      })
      created += 2
    }
  })

  return created
}

/**
 * Backfill hidden allocation legs for an irregular-income batch that only has the Savings credit
 * (e.g. after the Prisma null systemRole query bug). Idempotent when legs already exist.
 */
export async function repairIrregularIncomeFundingLegs(
  userId: string,
  batchId: string,
): Promise<number> {
  const batch = await prisma.envelopeFundingBatch.findFirst({
    where: { id: batchId, userId },
  })
  if (!batch) return 0

  const existingLegs = await prisma.transaction.count({
    where: {
      fundingBatchId: batchId,
      source: { in: [TX_SOURCE_FUNDING_OUT, TX_SOURCE_FUNDING_IN] },
    },
  })
  if (existingLegs > 0) return 0

  const incomeRow = await prisma.transaction.findFirst({
    where: {
      fundingBatchId: batchId,
      userId,
      source: TX_SOURCE_IRREGULAR_INCOME,
      type: "credit",
    },
  })
  if (!incomeRow) return 0

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { monthlyIncome: true, publicKey: true },
  })
  const pk = user?.publicKey?.trim()
  if (!user || !pk) return 0

  const mi = user.monthlyIncome
  if (!Number.isFinite(mi) || mi <= 0) return 0

  const savings = await ensureSystemSavingsEnvelope(userId)
  if (incomeRow.envelopeId !== savings.id) return 0

  const envelopeRows = await prisma.envelope.findMany({
    where: budgetEnvelopeWhere(userId),
    select: { id: true, monthlyAllotment: true, systemRole: true },
  })
  const envelopes = envelopeRows.filter((e) => isBudgetEnvelope(e.systemRole))

  let sumAllot = 0
  for (const e of envelopes) {
    const a = e.monthlyAllotment
    if (Number.isFinite(a) && a > 0) sumAllot += a
  }
  if (sumAllot > mi + 0.015) return 0

  const split = computeIrregularIncomeSplits({
    grossUsd: incomeRow.amount,
    monthlyIncome: mi,
    envelopes,
    excludeEnvelopeIds: new Set([savings.id]),
  })
  if (split.invalid) return 0

  const allocated = sumAllocatedIrregularCents(split)
  if (sumAllot > 0 && allocated <= 0) return 0

  const encAllocOut = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, pk)
  const encAllocIn = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, pk)
  if (!encAllocOut || !encAllocIn) return 0

  const dateStr = incomeRow.date.toISOString().slice(0, 10)
  const btcPrice = await getBtcPriceForDate(dateStr)
  const fundingDate = incomeRow.date

  let created = 0
  await prisma.$transaction(async (tx) => {
    for (const [envId, allocCents] of split.envelopeIdToCents) {
      const amt = allocCents / 100
      if (amt <= 0) continue

      await createFundingLeg(tx, {
        userId,
        envelopeId: savings.id,
        date: fundingDate,
        amount: amt,
        type: "expense",
        payeeCipher: encAllocOut,
        source: TX_SOURCE_FUNDING_OUT,
        excludeFromMainHistory: true,
        fundingBatchId: batchId,
        btcPrice,
      })
      await createFundingLeg(tx, {
        userId,
        envelopeId: envId,
        date: fundingDate,
        amount: amt,
        type: "credit",
        payeeCipher: encAllocIn,
        source: TX_SOURCE_FUNDING_IN,
        excludeFromMainHistory: true,
        fundingBatchId: batchId,
        btcPrice,
      })
      created += 2
    }
  })

  return created
}

const RETRO_MISSED_PAYCHECK_PERIOD_KEY = "retro-missed-paycheck"
const RETRO_PAYCHECK_PAYEE_PLAIN = "Missed paycheck (catch-up)"

export interface RetroMissedPaycheckStatus {
  applied: boolean
  eligible: boolean
  previewGrossUsd: number
  reason?:
    | "already_applied"
    | "no_public_key"
    | "no_income"
    | "no_envelopes"
    | "cadence_unsupported"
    | "amount_too_small"
}

export async function getRetroMissedPaycheckStatus(
  userId: string,
  runDateUtc?: Date,
): Promise<RetroMissedPaycheckStatus> {
  const now = runDateUtc ?? new Date()
  const dup = await prisma.envelopeFundingBatch.findUnique({
    where: {
      userId_periodKey_kind: {
        userId,
        periodKey: RETRO_MISSED_PAYCHECK_PERIOD_KEY,
        kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
      },
    },
  })
  if (dup) {
    return { applied: true, eligible: false, previewGrossUsd: 0, reason: "already_applied" }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      publicKey: true,
      monthlyIncome: true,
      payCadence: true,
      payDays: true,
      payDayOfWeek: true,
      lastPaydayAt: true,
    },
  })
  if (!user?.publicKey?.trim()) {
    return { applied: false, eligible: false, previewGrossUsd: 0, reason: "no_public_key" }
  }
  if (user.payCadence === "irregular" || user.payCadence === "mixed") {
    return { applied: false, eligible: false, previewGrossUsd: 0, reason: "cadence_unsupported" }
  }

  const mi = user.monthlyIncome
  if (!Number.isFinite(mi) || mi <= 0) {
    return { applied: false, eligible: false, previewGrossUsd: 0, reason: "no_income" }
  }

  const envelopeRows = await prisma.envelope.findMany({
    where: budgetEnvelopeWhere(userId),
    select: { id: true, monthlyAllotment: true, systemRole: true },
  })
  const envelopes = envelopeRows.filter((e) => isBudgetEnvelope(e.systemRole))
  const hasAllotted = envelopes.some((e) => Number.isFinite(e.monthlyAllotment) && e.monthlyAllotment > 0)
  if (!hasAllotted) {
    return { applied: false, eligible: false, previewGrossUsd: 0, reason: "no_envelopes" }
  }

  const dailyAllowed = isDailyPayCadenceAllowed()
  const gross = retroMissedPaycheckGrossUsd(
    mi,
    {
      monthlyIncome: mi,
      payCadence: user.payCadence,
      payDays: user.payDays,
      payDayOfWeek: user.payDayOfWeek,
      lastPaydayAt: user.lastPaydayAt,
    },
    now,
    dailyAllowed,
  )
  if (!Number.isFinite(gross) || gross < 0.01) {
    return { applied: false, eligible: false, previewGrossUsd: gross, reason: "amount_too_small" }
  }

  return { applied: false, eligible: true, previewGrossUsd: gross }
}

export async function createRetroMissedPaycheckBatch(
  userId: string,
  runDateUtc?: Date,
): Promise<{ ok: true; grossUsd: number; created: number } | { ok: false; error: string }> {
  const status = await getRetroMissedPaycheckStatus(userId, runDateUtc)
  if (status.reason === "already_applied") return { ok: false, error: "Catch-up paycheck was already added." }
  if (!status.eligible || status.reason) {
    return { ok: false, error: "You are not eligible for this catch-up right now." }
  }

  const gross = status.previewGrossUsd
  const now = runDateUtc ?? new Date()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      publicKey: true,
      monthlyIncome: true,
      payCadence: true,
      payDays: true,
      payDayOfWeek: true,
      lastPaydayAt: true,
    },
  })
  const pk = user?.publicKey?.trim()
  if (!user || !pk) return { ok: false, error: "Encryption is not set up yet." }

  const savings = await ensureSystemSavingsEnvelope(userId)

  const envelopeRows = await prisma.envelope.findMany({
    where: budgetEnvelopeWhere(userId),
    select: { id: true, monthlyAllotment: true, systemRole: true },
  })
  const envelopes = envelopeRows.filter((e) => isBudgetEnvelope(e.systemRole))
  const split = splitUsdProportionalByAllotment(gross, envelopes)
  if (split.size === 0) {
    return { ok: false, error: "Add monthly amounts to at least one spending envelope first." }
  }

  let allocSum = 0
  for (const v of split.values()) allocSum += v
  allocSum = Math.round(allocSum * 100) / 100
  if (allocSum > gross + 0.02) {
    return { ok: false, error: "Allocation math failed — try again or contact support." }
  }

  const dateStr = now.toISOString().split("T")[0]!
  const btcPrice = await getBtcPriceForDate(dateStr)
  const fundingDate = new Date(`${dateStr}T12:00:00.000Z`)

  const encIncomePayee = encryptFieldForUser(RETRO_PAYCHECK_PAYEE_PLAIN, pk)
  if (!encIncomePayee) return { ok: false, error: "Could not encrypt payee." }

  const encAllocOut = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, pk)
  const encAllocIn = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, pk)
  if (!encAllocOut || !encAllocIn) return { ok: false, error: "Could not encrypt allocation labels." }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const dup = await tx.envelopeFundingBatch.findUnique({
        where: {
          userId_periodKey_kind: {
            userId,
            periodKey: RETRO_MISSED_PAYCHECK_PERIOD_KEY,
            kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
          },
        },
      })
      if (dup) return 0

      let batch
      try {
        batch = await tx.envelopeFundingBatch.create({
          data: {
            userId,
            periodKey: RETRO_MISSED_PAYCHECK_PERIOD_KEY,
            kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
            config: { kind: "retro_missed_paycheck", grossUsd: gross } as object,
          },
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return 0
        }
        throw e
      }

      let n = 0
      await tx.transaction.create({
        data: {
          userId,
          envelopeId: savings.id,
          date: fundingDate,
          payee: encIncomePayee,
          amount: gross,
          type: "credit",
          tags: EMPTY_TAGS,
          notes: null,
          source: TX_SOURCE_RETRO_PAYCHECK,
          satsAmount: btcPrice ? usdToSats(gross, btcPrice) : null,
          excludeFromMainHistory: false,
          fundingBatchId: batch.id,
        },
      })
      n++

      for (const [envId, amt] of split) {
        if (amt <= 0) continue
        await createFundingLeg(tx, {
          userId,
          envelopeId: savings.id,
          date: fundingDate,
          amount: amt,
          type: "expense",
          payeeCipher: encAllocOut,
          source: TX_SOURCE_FUNDING_OUT,
          excludeFromMainHistory: true,
          fundingBatchId: batch.id,
          btcPrice,
        })
        await createFundingLeg(tx, {
          userId,
          envelopeId: envId,
          date: fundingDate,
          amount: amt,
          type: "credit",
          payeeCipher: encAllocIn,
          source: TX_SOURCE_FUNDING_IN,
          excludeFromMainHistory: true,
          fundingBatchId: batch.id,
          btcPrice,
        })
        n += 2
      }

      return n
    })
    if (created === 0) {
      return { ok: false, error: "Catch-up paycheck was already added." }
    }
    return { ok: true, grossUsd: gross, created }
  } catch {
    return { ok: false, error: "Could not record catch-up paycheck." }
  }
}
