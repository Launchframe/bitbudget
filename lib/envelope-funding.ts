import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import {
  ENVELOPE_FUNDING_BATCH_KIND_FUND,
  LEDGER_ALLOCATION_PAYEE_LABEL,
  LEDGER_INCOME_PAYEE_LABEL,
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
  isBudgetEnvelope,
} from "@/lib/constants"
import {
  allotmentSliceForFundingRun,
  fundingPeriodKeyForDate,
  grossIncomeForFundingRun,
} from "@/lib/envelope-funding-period"
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
import { savingsEnvelopeForUserDb } from "@/lib/ensure-system-savings-envelope"

export { ensureSystemSavingsEnvelope } from "@/lib/ensure-system-savings-envelope"

export const TX_SOURCE_PAYCHECK = "paycheck"
export const TX_SOURCE_IRREGULAR_INCOME = "irregular_income"
export const TX_SOURCE_FUNDING_OUT = "envelope_funding_out"
export const TX_SOURCE_FUNDING_IN = "envelope_funding_in"

const EMPTY_TAGS = "[]"

function fundingPeriodKeyForUser(
  user: PaydayUserFields,
  runDateUtc: Date,
  dailyAllowed: boolean,
): string | null {
  if (isDailyCadenceBlocked(user.payCadence, dailyAllowed)) return null

  if (usesPaydayCadence(user)) {
    if (!isPaydayForUser(user, runDateUtc)) return null
    return fundingPeriodKeyForPayday(user, runDateUtc)
  }
  return fundingPeriodKeyForDate({
    payCadence: user.payCadence,
    runDateUtc,
    dailyCadenceAllowed: dailyAllowed,
  })
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
 * Cron-funded paycheck-style batch for one user.
 * Returns number of transactions created (0 if skipped).
 */
export async function processEnvelopeFundingForUser(userId: string, runDateUtc?: Date): Promise<number> {
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

  const periodKey = fundingPeriodKeyForUser(paydayUser, now, dailyAllowed)
  if (!periodKey) return 0

  const savings = await savingsEnvelopeForUserDb(prisma, userId)
  if (!savings) return 0

  const gross = grossIncomeForFundingRun(user.monthlyIncome, user.payCadence, now, dailyAllowed)
  if (!Number.isFinite(gross) || gross <= 0) return 0

  const envelopeRows = await prisma.envelope.findMany({
    where: budgetEnvelopeWhere(userId),
    select: { id: true, monthlyAllotment: true, systemRole: true },
  })
  const envelopes = envelopeRows.filter((e) => isBudgetEnvelope(e.systemRole))

  type SliceRow = { id: string; slice: number }
  const slices: SliceRow[] = []
  let sumSlices = 0
  for (const e of envelopes) {
    const slice = allotmentSliceForFundingRun(
      e.monthlyAllotment,
      user.payCadence,
      now,
      dailyAllowed,
    )
    if (slice > 0) {
      slices.push({ id: e.id, slice })
      sumSlices += slice
    }
  }

  if (sumSlices > gross + 0.015) {
    return 0
  }

  const dateStr = now.toISOString().split("T")[0]!
  const btcPrice = await getBtcPriceForDate(dateStr)

  const encIncome = encryptFieldForUser(LEDGER_INCOME_PAYEE_LABEL, user.publicKey)
  const encAllocOut = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, user.publicKey)
  const encAllocIn = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, user.publicKey)

  if (!encIncome || !encAllocOut || !encAllocIn) return 0

  const fundingDate = new Date(`${dateStr}T12:00:00.000Z`)

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
    created++

    for (const row of slices) {
      await createFundingLeg(tx, {
        userId,
        envelopeId: savings.id,
        date: fundingDate,
        amount: row.slice,
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
        amount: row.slice,
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
}

/** Manual irregular income: one visible Savings credit + hidden allocation legs. */
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

  const savings = await savingsEnvelopeForUserDb(prisma, input.userId)
  if (!savings) return 0

  const envelopeRows = await prisma.envelope.findMany({
    where: budgetEnvelopeWhere(input.userId),
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
    grossUsd: gross,
    monthlyIncome: mi,
    envelopes,
    excludeEnvelopeIds: new Set([savings.id]),
  })
  if (split.invalid) return 0

  const grossCents = cents(gross)
  const allocated = sumAllocatedIrregularCents(split)
  if (allocated > grossCents + 1) return 0
  if (sumAllot > 0 && allocated <= 0) return 0

  const dateStr = input.dateIso
  const btcPrice = await getBtcPriceForDate(dateStr)
  const fundingDate = new Date(`${dateStr}T12:00:00.000Z`)

  const encIncomePayee = encryptFieldForUser(input.displayPayee.trim(), pk)
  if (!encIncomePayee) return 0

  const encNotes =
    input.notesPlain?.trim() ? encryptFieldForUser(input.notesPlain.trim(), pk) : null

  const encAllocOut = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, pk)
  const encAllocIn = encryptFieldForUser(LEDGER_ALLOCATION_PAYEE_LABEL, pk)
  if (!encAllocOut || !encAllocIn) return 0

  const periodKey = `irr-${randomUUID()}`
  let created = 0

  await prisma.$transaction(async (tx) => {
    const batch = await tx.envelopeFundingBatch.create({
      data: {
        userId: input.userId,
        periodKey,
        kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
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

    for (const [envId, allocCents] of split.envelopeIdToCents) {
      const amt = allocCents / 100
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

  const savings = await savingsEnvelopeForUserDb(prisma, userId)
  if (!savings || incomeRow.envelopeId !== savings.id) return 0

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
