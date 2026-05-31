import { prisma } from "@/lib/db"
import type { Prisma } from "@prisma/client"
import { TX_SOURCE_ENVELOPE_SWEEP, TX_SOURCE_INCOME_IMPORT } from "@/lib/constants"
import {
  TX_SOURCE_FUNDING_OUT,
  TX_SOURCE_IRREGULAR_INCOME,
  TX_SOURCE_PAYCHECK,
} from "@/lib/envelope-funding"

export function monthKeyFromDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

const SAVINGS_INFLOW_SOURCES = [
  TX_SOURCE_PAYCHECK,
  TX_SOURCE_IRREGULAR_INCOME,
  TX_SOURCE_INCOME_IMPORT,
  TX_SOURCE_ENVELOPE_SWEEP,
] as const

async function envelopeBalanceFromAggregates(
  where: Prisma.TransactionWhereInput,
): Promise<number> {
  const [credits, expenses] = await Promise.all([
    prisma.transaction.aggregate({
      where: { ...where, type: "credit" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { ...where, type: "expense" },
      _sum: { amount: true },
    }),
  ])
  const creditSum = credits._sum.amount != null ? Number(credits._sum.amount) : 0
  const expenseSum = expenses._sum.amount != null ? Number(expenses._sum.amount) : 0
  return Math.round((creditSum - expenseSum) * 100) / 100
}

/** Sum credits minus expenses for all transactions on an envelope (Savings hub balance). */
export async function savingsEnvelopeBalanceAllTime(
  userId: string,
  envelopeId: string,
): Promise<number> {
  return envelopeBalanceFromAggregates({ userId, envelopeId })
}

/** Envelope balance before a UTC instant (half-open: date < beforeExclusive). */
export async function savingsEnvelopeBalanceBefore(
  userId: string,
  envelopeId: string,
  beforeExclusive: Date,
): Promise<number> {
  return envelopeBalanceFromAggregates({
    userId,
    envelopeId,
    date: { lt: beforeExclusive },
  })
}

type BalanceQueryClient = Pick<typeof prisma, "transaction" | "envelope">

/** All-time net balances for many envelopes (credits minus expenses). */
export async function envelopeBalancesAllTimeBatch(
  userId: string,
  envelopeIds: readonly string[],
  client: BalanceQueryClient = prisma,
): Promise<Map<string, number>> {
  return envelopeBalancesBeforeBatch(userId, envelopeIds, undefined, client)
}

/**
 * Envelope balances before a UTC instant (half-open: date < beforeExclusive). Omit for all-time.
 *
 * Applies genesis filtering: each envelope's balance only counts transactions dated on or
 * after one calendar day before the envelope's createdAt (UTC).  This prevents historical
 * CSV imports from driving newly-created envelopes deeply negative.
 *
 * The one-day safety margin ensures same-day transactions are always included for users
 * in western timezones whose local date may be behind UTC at time of envelope creation.
 */
export async function envelopeBalancesBeforeBatch(
  userId: string,
  envelopeIds: readonly string[],
  beforeExclusive?: Date,
  client: BalanceQueryClient = prisma,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (envelopeIds.length === 0) return result
  for (const id of envelopeIds) result.set(id, 0)

  // Load genesis dates (one day before createdAt to handle timezone edge cases).
  const envelopeRows = await client.envelope.findMany({
    where: { id: { in: [...envelopeIds] }, userId },
    select: { id: true, createdAt: true },
  })
  const genesisMap = new Map<string, string>()
  for (const e of envelopeRows) {
    const d = new Date(e.createdAt)
    d.setUTCDate(d.getUTCDate() - 1)
    genesisMap.set(e.id, d.toISOString().slice(0, 10))
  }

  const txns = await client.transaction.findMany({
    where: {
      userId,
      envelopeId: { in: [...envelopeIds] },
      ...(beforeExclusive ? { date: { lt: beforeExclusive } } : {}),
    },
    select: { envelopeId: true, type: true, amount: true, date: true },
  })

  for (const txn of txns) {
    const genesis = genesisMap.get(txn.envelopeId!)
    if (genesis && txn.date.toISOString().slice(0, 10) < genesis) continue
    const cur = result.get(txn.envelopeId!) ?? 0
    const delta = txn.type === "credit" ? Number(txn.amount) : -Number(txn.amount)
    result.set(txn.envelopeId!, cur + delta)
  }

  for (const [id, value] of result) {
    result.set(id, Math.round(value * 100) / 100)
  }
  return result
}

/**
 * End-of-month envelope balances for many YYYY-MM keys in one transaction scan.
 * Each snapshot uses date < month end (same semantics as envelopeBalancesBeforeBatch).
 */
export async function envelopeBalancesBeforeMonthEndsBatch(
  userId: string,
  envelopeIds: readonly string[],
  monthKeys: readonly string[],
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>()
  if (envelopeIds.length === 0 || monthKeys.length === 0) return result

  const endByMonth = new Map<string, Date>()
  for (const mk of monthKeys) {
    const bounds = periodBoundsUtc(mk)
    if (!bounds) continue
    endByMonth.set(mk, bounds.end)
  }
  if (endByMonth.size === 0) return result

  let maxEndMs = 0
  for (const end of endByMonth.values()) {
    maxEndMs = Math.max(maxEndMs, end.getTime())
  }

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      envelopeId: { in: [...envelopeIds] },
      date: { lt: new Date(maxEndMs) },
    },
    select: { envelopeId: true, date: true, type: true, amount: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  })

  const running = new Map<string, number>()
  for (const id of envelopeIds) running.set(id, 0)

  const sortedMonths = [...endByMonth.entries()].sort((a, b) => a[1].getTime() - b[1].getTime())
  let rowIdx = 0

  for (const [monthKey, end] of sortedMonths) {
    while (rowIdx < rows.length && rows[rowIdx]!.date < end) {
      const row = rows[rowIdx]!
      const delta = row.type === "credit" ? Number(row.amount) : -Number(row.amount)
      running.set(row.envelopeId, (running.get(row.envelopeId) ?? 0) + delta)
      rowIdx++
    }
    const snap = new Map<string, number>()
    for (const id of envelopeIds) {
      snap.set(id, Math.round((running.get(id) ?? 0) * 100) / 100)
    }
    result.set(monthKey, snap)
  }

  return result
}

/** Month-scoped balances for many envelopes in one query. */
export async function envelopeBalancesForMonthBatch(
  userId: string,
  envelopeIds: readonly string[],
  monthKey: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (envelopeIds.length === 0) return result
  for (const id of envelopeIds) result.set(id, 0)

  const bounds = periodBoundsUtc(monthKey)
  if (!bounds) return result

  const rows = await prisma.transaction.groupBy({
    by: ["envelopeId", "type"],
    where: {
      userId,
      envelopeId: { in: [...envelopeIds] },
      date: { gte: bounds.start, lt: bounds.end },
    },
    _sum: { amount: true },
  })
  for (const row of rows) {
    const cur = result.get(row.envelopeId) ?? 0
    const sum = row._sum.amount != null ? Number(row._sum.amount) : 0
    const delta = row.type === "credit" ? sum : -sum
    result.set(row.envelopeId, cur + delta)
  }
  for (const [id, value] of result) {
    result.set(id, Math.round(value * 100) / 100)
  }
  return result
}

/** Month-scoped envelope balance (matches client getEnvelopeBalance for a calendar month). */
export async function envelopeBalanceForMonth(
  userId: string,
  envelopeId: string,
  monthKey: string,
): Promise<number> {
  const balances = await envelopeBalancesForMonthBatch(userId, [envelopeId], monthKey)
  return balances.get(envelopeId) ?? 0
}

/** Period bounds for a YYYY-MM calendar month (UTC, half-open interval). */
export function periodBoundsUtc(periodKey: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}$/.test(periodKey)) return null
  const [y, m] = periodKey.split("-").map(Number)
  return {
    start: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
  }
}

/**
 * Sum of inflow credits to Savings minus allocation legs out during a calendar month.
 */
export async function netSavingsInflowForPeriod(
  userId: string,
  savingsEnvelopeId: string,
  periodKey: string,
): Promise<number> {
  const bounds = periodBoundsUtc(periodKey)
  if (!bounds) return 0

  const dateFilter = { gte: bounds.start, lt: bounds.end }
  const base = { userId, envelopeId: savingsEnvelopeId, date: dateFilter }

  const [credits, out] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        ...base,
        type: "credit",
        source: { in: [...SAVINGS_INFLOW_SOURCES] },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        ...base,
        type: "expense",
        source: TX_SOURCE_FUNDING_OUT,
      },
      _sum: { amount: true },
    }),
  ])

  const creditSum = credits._sum.amount != null ? Number(credits._sum.amount) : 0
  const outSum = out._sum.amount != null ? Number(out._sum.amount) : 0
  return Math.round((creditSum - outSum) * 100) / 100
}
