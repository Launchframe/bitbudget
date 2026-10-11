import {
  isBudgetEnvelope,
  TX_SOURCE_ENVELOPE_SWEEP,
  TX_SOURCE_ENVELOPE_TRANSFER_OUT,
} from "@/lib/constants"
import { isPaydayForUser, type PaydayUserFields } from "@/lib/payday-cadence"
import { getMonthKey, type Transaction } from "@/lib/data"
import type { SavingsGoalRow } from "@/lib/savings-ui-metrics"

export type MonthOverlayMode = "cash_flow" | "savings"

export interface MonthOverlayPoint {
  day: number
  value: number | null
}

export interface MonthOverlaySeries {
  monthKey: string
  label: string
  isLatest: boolean
  points: MonthOverlayPoint[]
  endValue: number | null
}

export interface MonthOverlayChartData {
  series: MonthOverlaySeries[]
  chartRows: Array<Record<string, number | null> & { day: number }>
  bestMonthKey: string | null
  worstMonthKey: string | null
}

export function computeSavingsConsistencyScore(
  closedGoals: Pick<SavingsGoalRow, "achievedGoal">[],
): number | null {
  if (closedGoals.length === 0) return null
  const achieved = closedGoals.filter(g => g.achievedGoal === true).length
  return Math.round((achieved / closedGoals.length) * 100)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function parseMonthKey(monthKey: string): { year: number; monthIndex: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!m) return null
  const year = Number(m[1])
  const monthIndex = Number(m[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) return null
  return { year, monthIndex }
}

export function monthKeysInLookback(count: number, anchor = new Date()): string[] {
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`)
  }
  return keys
}

export function findFirstPaydayDom(user: PaydayUserFields, year: number, monthIndex: number): number {
  if (user.payCadence === "irregular" || user.payCadence === "mixed") return 1
  const dim = daysInMonth(year, monthIndex)
  for (let dom = 1; dom <= dim; dom++) {
    const date = new Date(Date.UTC(year, monthIndex, dom, 12, 0, 0))
    if (isPaydayForUser(user, date)) return dom
  }
  return 1
}

function formatMonthLabel(monthKey: string): string {
  const parsed = parseMonthKey(monthKey)
  if (!parsed) return monthKey
  const d = new Date(Date.UTC(parsed.year, parsed.monthIndex, 1))
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
}

function buildDailyDiscretionaryExpenseTotals(
  transactions: readonly Transaction[],
  discretionaryIds: ReadonlySet<string>,
  monthKey: string,
): Map<number, number> {
  const byDom = new Map<number, number>()
  for (const t of transactions) {
    if (t.excludeFromMainHistory) continue
    if (t.type !== "expense") continue
    if (!discretionaryIds.has(t.envelopeId)) continue
    // Exclude internal ledger transfers: monthly sweeps (RESET/CAPPED policy) and
    // envelope-to-envelope rebalances are not real user spending.
    const src = t.source ?? "manual"
    if (src === TX_SOURCE_ENVELOPE_SWEEP || src === TX_SOURCE_ENVELOPE_TRANSFER_OUT) continue
    if (getMonthKey(t.date) !== monthKey) continue
    const dom = Number(t.date.slice(8, 10))
    if (!Number.isFinite(dom)) continue
    byDom.set(dom, (byDom.get(dom) ?? 0) + t.amount)
  }
  return byDom
}

function buildDailySavingsNetTotals(
  transactions: readonly Transaction[],
  savingsEnvelopeId: string,
  monthKey: string,
): Map<number, number> {
  const byDom = new Map<number, number>()
  for (const t of transactions) {
    if (getMonthKey(t.date) !== monthKey) continue
    if (t.envelopeId !== savingsEnvelopeId) continue
    const dom = Number(t.date.slice(8, 10))
    if (!Number.isFinite(dom)) continue
    const delta = t.type === "credit" ? t.amount : -t.amount
    byDom.set(dom, (byDom.get(dom) ?? 0) + delta)
  }
  return byDom
}

/** Prefix sums: index 0 = 0, index d = sum of daily totals for days 1..d. */
function cumulativeTotalsByDom(dim: number, daily: Map<number, number>): number[] {
  const cum = new Array<number>(dim + 1)
  cum[0] = 0
  for (let d = 1; d <= dim; d++) {
    cum[d] = cum[d - 1]! + (daily.get(d) ?? 0)
  }
  return cum
}

function buildSeriesForMonth(params: {
  mode: MonthOverlayMode
  monthKey: string
  isLatest: boolean
  transactions: readonly Transaction[]
  paydayUser: PaydayUserFields
  monthlyBudget: number
  savingsEnvelopeId: string | null
  discretionaryEnvelopeIds: ReadonlySet<string>
  todayDom: number | null
}): MonthOverlaySeries {
  const parsed = parseMonthKey(params.monthKey)
  const dim = parsed ? daysInMonth(parsed.year, parsed.monthIndex) : 31
  const firstPayday = parsed
    ? findFirstPaydayDom(params.paydayUser, parsed.year, parsed.monthIndex)
    : 1
  const lastDay =
    params.isLatest && params.todayDom != null ? Math.min(dim, params.todayDom) : dim

  const expenseCum =
    params.mode === "cash_flow"
      ? cumulativeTotalsByDom(
          dim,
          buildDailyDiscretionaryExpenseTotals(
            params.transactions,
            params.discretionaryEnvelopeIds,
            params.monthKey,
          ),
        )
      : null
  const savingsCum =
    params.mode === "savings" && params.savingsEnvelopeId
      ? cumulativeTotalsByDom(
          dim,
          buildDailySavingsNetTotals(
            params.transactions,
            params.savingsEnvelopeId,
            params.monthKey,
          ),
        )
      : null

  const points: MonthOverlayPoint[] = []

  for (let day = 1; day <= 31; day++) {
    if (day > dim) {
      points.push({ day, value: null })
      continue
    }
    if (day < firstPayday) {
      points.push({ day, value: null })
      continue
    }
    if (day > lastDay) {
      points.push({ day, value: null })
      continue
    }

    if (params.mode === "cash_flow" && expenseCum) {
      const spent = expenseCum[day]! - expenseCum[firstPayday - 1]!
      points.push({ day, value: params.monthlyBudget - spent })
    } else if (savingsCum) {
      points.push({ day, value: savingsCum[day]! })
    } else {
      points.push({ day, value: null })
    }
  }

  const endValue =
    [...points].reverse().find(p => p.value != null)?.value ?? null

  return {
    monthKey: params.monthKey,
    label: formatMonthLabel(params.monthKey),
    isLatest: params.isLatest,
    points,
    endValue,
  }
}

function bestWorstFromClosedGoals(
  closedGoals: SavingsGoalRow[],
  monthKeys: readonly string[],
): { best: string | null; worst: string | null } {
  const inRange = closedGoals.filter(
    g => g.closedAt && monthKeys.includes(g.periodKey) && g.actualSavedAmount != null,
  )
  if (inRange.length === 0) return { best: null, worst: null }

  let best = inRange[0]!
  let worst = inRange[0]!
  for (const row of inRange) {
    const amt = row.actualSavedAmount ?? 0
    if (amt > (best.actualSavedAmount ?? 0)) best = row
    if (amt < (worst.actualSavedAmount ?? 0)) worst = row
  }
  return { best: best.periodKey, worst: worst.periodKey }
}

function bestWorstFromSeries(
  series: MonthOverlaySeries[],
): { best: string | null; worst: string | null } {
  const withEnd = series.filter(s => s.endValue != null)
  if (withEnd.length === 0) return { best: null, worst: null }
  let best = withEnd[0]!
  let worst = withEnd[0]!
  for (const row of withEnd) {
    if ((row.endValue ?? 0) > (best.endValue ?? 0)) best = row
    if ((row.endValue ?? 0) < (worst.endValue ?? 0)) worst = row
  }
  return { best: best.monthKey, worst: worst.monthKey }
}

export function buildMonthOverlayChartData(params: {
  mode: MonthOverlayMode
  transactions: readonly Transaction[]
  monthCount: number
  paydayUser: PaydayUserFields
  monthlyBudget: number
  savingsEnvelopeId: string | null
  discretionaryEnvelopeIds: ReadonlySet<string>
  closedGoals?: SavingsGoalRow[]
  now?: Date
}): MonthOverlayChartData {
  const now = params.now ?? new Date()
  const monthKeys = monthKeysInLookback(params.monthCount, now)
  const latestKey = monthKeys[monthKeys.length - 1] ?? null
  const todayDom = now.getUTCDate()

  const series = monthKeys.map(monthKey =>
    buildSeriesForMonth({
      mode: params.mode,
      monthKey,
      isLatest: monthKey === latestKey,
      transactions: params.transactions,
      paydayUser: params.paydayUser,
      monthlyBudget: params.monthlyBudget,
      savingsEnvelopeId: params.savingsEnvelopeId,
      discretionaryEnvelopeIds: params.discretionaryEnvelopeIds,
      todayDom: monthKey === latestKey ? todayDom : null,
    }),
  )

  const chartRows: MonthOverlayChartData["chartRows"] = []
  for (let day = 1; day <= 31; day++) {
    const row: Record<string, number | null> & { day: number } = { day }
    for (const s of series) {
      row[s.monthKey] = s.points.find(p => p.day === day)?.value ?? null
    }
    chartRows.push(row)
  }

  const closed = params.closedGoals ?? []
  const fromGoals =
    params.mode === "savings"
      ? bestWorstFromClosedGoals(closed, monthKeys)
      : { best: null as string | null, worst: null as string | null }

  const fromSeries = bestWorstFromSeries(series)

  return {
    series,
    chartRows,
    bestMonthKey: fromGoals.best ?? fromSeries.best,
    worstMonthKey: fromGoals.worst ?? fromSeries.worst,
  }
}

/** Resolve discretionary envelope ids from a full envelope list. */
export function discretionaryEnvelopeIdsFromEnvelopes(
  envelopes: ReadonlyArray<{ id: string; archived?: boolean; systemRole?: string | null }>,
): Set<string> {
  return new Set(
    envelopes
      .filter(e => !e.archived && isBudgetEnvelope(e.systemRole))
      .map(e => e.id),
  )
}
