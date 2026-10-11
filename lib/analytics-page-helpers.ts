import type { Envelope, Transaction } from "@/lib/data"
import { isUserFacingExpense } from "@/lib/transaction-visibility"
import { isCashInflowCredit } from "@/lib/cash-flow-series"

export interface HeatmapDay {
  date: string
  count: number
  spent: number
  inRange: boolean
}

export interface SankeyNode {
  name: string
  color: string
}

export interface SankeyLink {
  source: number
  target: number
  value: number
}

export interface IncomeFlowResult {
  data: { nodes: SankeyNode[]; links: SankeyLink[] }
  totalIncome: number
  totalExpenses: number
  unspent: number
  overspent: number
}

/**
 * Build per-day heatmap data for the analytics daily-activity grid.
 *
 * `count` = all transactions visible in the main transaction list (not hidden
 * ledger legs). `spent` = user-facing expense amount only — excludes envelope
 * sweeps, rebalance legs, deficit covers, and other internal transfers so the
 * "$ Volume" mode does not balloon on the 1st of each month or on rebalance days.
 */
export function buildHeatmapDays(
  transactions: Transaction[],
  startDate: string,
  endDate: string,
): HeatmapDay[] {
  if (transactions.length === 0) return []

  const rangeDays = getDaysBetween(startDate, endDate)
  if (rangeDays.length === 0) return []

  const firstDate = parseIsoDate(rangeDays[0]!)
  const lastDate = parseIsoDate(rangeDays[rangeDays.length - 1]!)
  if (!firstDate || !lastDate) return []

  const paddedStart = addDays(firstDate, -firstDate.getUTCDay())
  const paddedEnd = addDays(lastDate, 6 - lastDate.getUTCDay())
  const byDay = new Map<string, { count: number; spent: number }>()

  for (const txn of transactions) {
    if (txn.excludeFromMainHistory) continue
    const entry = byDay.get(txn.date) ?? { count: 0, spent: 0 }
    entry.count += 1
    if (isUserFacingExpense(txn)) {
      entry.spent += txn.amount
    }
    byDay.set(txn.date, entry)
  }

  const days: HeatmapDay[] = []
  let current = paddedStart
  while (current <= paddedEnd) {
    const date = toIsoDate(current)
    const entry = byDay.get(date) ?? { count: 0, spent: 0 }
    days.push({
      date,
      count: entry.count,
      spent: entry.spent,
      inRange: date >= startDate && date <= endDate,
    })
    current = addDays(current, 1)
  }
  return days
}

/**
 * Build the income→envelope Sankey flow for the analytics "Income Flow" section.
 *
 * Income = real cash inflows only (irregular income, imports, Plaid, manual).
 * Expenses = user-facing spending only — excludes sweeps, rebalance legs, and
 * deficit covers so envelope spending is not double-counted on sweep/rebalance days.
 */
export function buildIncomeFlowData(
  transactions: Transaction[],
  activeEnvelopes: Envelope[],
): IncomeFlowResult {
  const envelopeSpend = new Map<string, number>()
  let totalIncome = 0
  let totalExpenses = 0

  for (const txn of transactions) {
    if (isCashInflowCredit(txn)) {
      totalIncome += txn.amount
    } else if (isUserFacingExpense(txn)) {
      totalExpenses += txn.amount
      envelopeSpend.set(txn.envelopeId, (envelopeSpend.get(txn.envelopeId) ?? 0) + txn.amount)
    }
  }

  const spendNodes = activeEnvelopes
    .map((env) => ({
      id: env.id,
      name: env.name,
      color: env.color,
      value: envelopeSpend.get(env.id) ?? 0,
    }))
    .filter((env) => env.value > 0)
    .sort((a, b) => b.value - a.value)

  const nodes: SankeyNode[] = [{ name: "Income", color: "#22C55E" }]
  const links: SankeyLink[] = []
  const overspent = Math.max(totalExpenses - totalIncome, 0)
  const overspentSourceIndex =
    overspent > 0 ? nodes.push({ name: "Over income", color: "#F59E0B" }) - 1 : null
  const incomeCoverage = totalExpenses > 0 ? Math.min(totalIncome, totalExpenses) / totalExpenses : 0

  for (const env of spendNodes) {
    nodes.push({ name: env.name, color: env.color })
    const target = nodes.length - 1
    const incomeFunded = env.value * incomeCoverage
    const overIncomeFunded = env.value - incomeFunded

    if (incomeFunded > 0) {
      links.push({ source: 0, target, value: incomeFunded })
    }
    if (overspentSourceIndex !== null && overIncomeFunded > 0) {
      links.push({ source: overspentSourceIndex, target, value: overIncomeFunded })
    }
  }

  const unspent = Math.max(totalIncome - totalExpenses, 0)
  if (unspent > 0) {
    nodes.push({ name: "Unspent", color: "#3B82F6" })
    links.push({ source: 0, target: nodes.length - 1, value: unspent })
  }

  return { data: { nodes, links }, totalIncome, totalExpenses, unspent, overspent }
}

// ─── small date helpers (duplicated from analytics-page.tsx to keep lib pure) ─

function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

function parseIsoDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = new Date(`${date}T12:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function getDaysBetween(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (!start || !end || start > end) return []

  const days: string[] = []
  let current = start
  while (current <= end) {
    days.push(toIsoDate(current))
    current = addDays(current, 1)
  }
  return days
}
