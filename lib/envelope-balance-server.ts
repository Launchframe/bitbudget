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
