import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import {
  LEDGER_ALLOCATION_PAYEE_LABEL,
  LEDGER_INCOME_PAYEE_LABEL,
  RESERVED_SAVINGS_ENVELOPE_NAME,
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
} from "@/lib/constants"
import {
  allotmentSliceForFundingRun,
  fundingPeriodKeyForDate,
  grossIncomeForFundingRun,
} from "@/lib/envelope-funding-period"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import { encryptFieldForUser } from "@/lib/server-encrypt"
import { isDailyPayCadenceAllowed } from "@/lib/pay-cadence-server"
import {
  computeIrregularIncomeSplits,
  sumAllocatedIrregularCents,
} from "@/lib/irregular-income-split"

export const TX_SOURCE_PAYCHECK = "paycheck"
export const TX_SOURCE_IRREGULAR_INCOME = "irregular_income"
export const TX_SOURCE_FUNDING_OUT = "envelope_funding_out"
export const TX_SOURCE_FUNDING_IN = "envelope_funding_in"

const EMPTY_TAGS = "[]"

async function savingsEnvelopeForUser(userId: string): Promise<{ id: string } | null> {
  const row = await prisma.envelope.findFirst({
    where: { userId, systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS, archived: false },
    select: { id: true },
  })
  return row
}

/** Ensure system Savings envelope exists (idempotent). Un-archives a legacy Savings-named row if needed. */
export async function ensureSystemSavingsEnvelope(userId: string): Promise<{ id: string }> {
  const existing = await savingsEnvelopeForUser(userId)
  if (existing) return existing

  const legacyNamed = await prisma.envelope.findFirst({
    where: {
      userId,
      name: { equals: RESERVED_SAVINGS_ENVELOPE_NAME, mode: "insensitive" },
    },
    select: { id: true },
  })
  if (legacyNamed) {
    return prisma.envelope.update({
      where: { id: legacyNamed.id },
      data: {
        archived: false,
        name: RESERVED_SAVINGS_ENVELOPE_NAME,
        monthlyAllotment: 0,
        systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
      },
      select: { id: true },
    })
  }

  try {
    return await prisma.envelope.create({
      data: {
        userId,
        name: RESERVED_SAVINGS_ENVELOPE_NAME,
        monthlyAllotment: 0,
        systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
        color: "#22C55E",
      },
      select: { id: true },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const promoted = await savingsEnvelopeForUser(userId)
      if (promoted) return promoted
      const again = await prisma.envelope.findFirst({
        where: {
          userId,
          name: { equals: RESERVED_SAVINGS_ENVELOPE_NAME, mode: "insensitive" },
        },
        select: { id: true },
      })
      if (again) {
        return prisma.envelope.update({
          where: { id: again.id },
          data: {
            archived: false,
            name: RESERVED_SAVINGS_ENVELOPE_NAME,
            monthlyAllotment: 0,
            systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
          },
          select: { id: true },
        })
      }
    }
    throw e
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
      ledgerFundingEnabled: true,
      monthlyIncome: true,
      payCadence: true,
      publicKey: true,
    },
  })

  if (!user?.ledgerFundingEnabled) return 0
  if (!user.publicKey?.trim()) return 0

  const periodKey = fundingPeriodKeyForDate({
    payCadence: user.payCadence,
    runDateUtc: now,
    dailyCadenceAllowed: dailyAllowed,
  })
  if (!periodKey) return 0

  const savings = await savingsEnvelopeForUser(userId)
  if (!savings) return 0

  const gross = grossIncomeForFundingRun(user.monthlyIncome, user.payCadence, now, dailyAllowed)
  if (!Number.isFinite(gross) || gross <= 0) return 0

  const envelopes = await prisma.envelope.findMany({
    where: {
      userId,
      archived: false,
      NOT: { systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS },
    },
    select: { id: true, monthlyAllotment: true },
  })

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
      where: { userId_periodKey: { userId, periodKey } },
    })
    if (dup) return 0

    let batch
    try {
      batch = await tx.envelopeFundingBatch.create({
        data: { userId, periodKey },
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

/** Process ledger funding for every user with the flag enabled. */
export async function processAllEnvelopeFunding(asOf?: Date): Promise<number> {
  const users = await prisma.user.findMany({
    where: { ledgerFundingEnabled: true },
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
  /** When set, skips reloading `User.ledgerFundingEnabled` / `monthlyIncome` from the database. */
  userLedger?: { ledgerFundingEnabled: boolean; monthlyIncome: number }
}

/** Manual irregular income: one visible Savings credit + hidden allocation legs. */
export async function createIrregularIncomeBatch(input: IrregularIncomeInput): Promise<number> {
  const pk = input.publicKey?.trim()
  if (!pk) return 0

  const gross = input.grossUsd
  if (!Number.isFinite(gross) || gross <= 0) return 0

  const user =
    input.userLedger ??
    (await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        ledgerFundingEnabled: true,
        monthlyIncome: true,
      },
    }))
  if (!user?.ledgerFundingEnabled) return 0

  const mi = user.monthlyIncome
  if (!Number.isFinite(mi) || mi <= 0) return 0

  const savings = await savingsEnvelopeForUser(input.userId)
  if (!savings) return 0

  const envelopes = await prisma.envelope.findMany({
    where: {
      userId: input.userId,
      archived: false,
      NOT: { systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS },
    },
    select: { id: true, monthlyAllotment: true },
  })

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
      data: { userId: input.userId, periodKey },
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
