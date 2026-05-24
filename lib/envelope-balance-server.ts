import { prisma } from "@/lib/db"
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

/** Sum credits minus expenses for all transactions on an envelope (Savings hub balance). */
export async function savingsEnvelopeBalanceAllTime(
  userId: string,
  envelopeId: string,
): Promise<number> {
  const rows = await prisma.transaction.findMany({
    where: { userId, envelopeId },
    select: { amount: true, type: true },
  })
  let balance = 0
  for (const row of rows) {
    if (row.type === "credit") balance += row.amount
    else balance -= row.amount
  }
  return Math.round(balance * 100) / 100
}

/** Envelope balance before a UTC instant (half-open: date < beforeExclusive). */
export async function savingsEnvelopeBalanceBefore(
  userId: string,
  envelopeId: string,
  beforeExclusive: Date,
): Promise<number> {
  const rows = await prisma.transaction.findMany({
    where: { userId, envelopeId, date: { lt: beforeExclusive } },
    select: { amount: true, type: true },
  })
  let balance = 0
  for (const row of rows) {
    if (row.type === "credit") balance += row.amount
    else balance -= row.amount
  }
  return Math.round(balance * 100) / 100
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

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      envelopeId: { in: [...envelopeIds] },
      date: { gte: bounds.start, lt: bounds.end },
    },
    select: { envelopeId: true, amount: true, type: true },
  })
  for (const row of rows) {
    const cur = result.get(row.envelopeId) ?? 0
    const delta = row.type === "credit" ? row.amount : -row.amount
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

  const creditRows = await prisma.transaction.findMany({
    where: {
      userId,
      envelopeId: savingsEnvelopeId,
      type: "credit",
      source: { in: [...SAVINGS_INFLOW_SOURCES] },
      date: { gte: bounds.start, lt: bounds.end },
    },
    select: { amount: true },
  })
  const outRows = await prisma.transaction.findMany({
    where: {
      userId,
      envelopeId: savingsEnvelopeId,
      type: "expense",
      source: TX_SOURCE_FUNDING_OUT,
      date: { gte: bounds.start, lt: bounds.end },
    },
    select: { amount: true },
  })

  const credits = creditRows.reduce((s, r) => s + r.amount, 0)
  const out = outRows.reduce((s, r) => s + r.amount, 0)
  return Math.round((credits - out) * 100) / 100
}
