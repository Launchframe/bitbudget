import { prisma } from "@/lib/db"
import {
  TX_SOURCE_ENVELOPE_SWEEP,
  TX_SOURCE_FUNDING_OUT,
  TX_SOURCE_INCOME_IMPORT,
  TX_SOURCE_IRREGULAR_INCOME,
} from "@/lib/constants"
import { TX_SOURCE_PAYCHECK } from "@/lib/envelope-funding"

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

/** Month-scoped envelope balance (matches client getEnvelopeBalance for a calendar month). */
export async function envelopeBalanceForMonth(
  userId: string,
  envelopeId: string,
  monthKey: string,
): Promise<number> {
  const [y, m] = monthKey.split("-").map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      envelopeId,
      date: { gte: start, lt: end },
    },
    select: { amount: true, type: true },
  })
  let balance = 0
  for (const row of rows) {
    if (row.type === "credit") balance += row.amount
    else balance -= row.amount
  }
  return Math.round(balance * 100) / 100
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
