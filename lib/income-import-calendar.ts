import type { IncomeImportEntry } from "@/lib/income-import"

export type CellVisualState = "empty" | "shaded" | "tx0" | "preHistory"

export interface PeriodDiff {
  periodKey: string
  newAmount: number
  existingAmount: number
  delta: number
}

export interface ImportSummary {
  rows: PeriodDiff[]
  totalExisting: number
  totalPending: number
  totalCombined: number
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/

export function buildCalendarYears(currentYear: number, floor = 1900): number[] {
  const start = Math.max(floor, 1900)
  const end = Math.max(start, currentYear)
  const years: number[] = []
  for (let y = end; y >= start; y--) years.push(y)
  return years
}

export function monthsInRangeChronological(a: string, b: string): string[] {
  if (!MONTH_KEY_RE.test(a) || !MONTH_KEY_RE.test(b)) return []
  const [ay, am] = a.split("-").map(Number)
  const [by, bm] = b.split("-").map(Number)
  let y = ay
  let m = am
  const endY = by
  const endM = bm

  const forward = a <= b
  const out: string[] = []

  if (forward) {
    while (y < endY || (y === endY && m <= endM)) {
      out.push(`${y}-${String(m).padStart(2, "0")}`)
      m += 1
      if (m > 12) {
        m = 1
        y += 1
      }
    }
  } else {
    while (y > endY || (y === endY && m >= endM)) {
      out.push(`${y}-${String(m).padStart(2, "0")}`)
      m -= 1
      if (m < 1) {
        m = 12
        y -= 1
      }
    }
  }

  return out
}

export function gradientIntensity(amount: number, p95Max: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || p95Max <= 0) return 0
  return Math.min(1, amount / p95Max)
}

/** Heatmap fill: highest staged amount = 1.0, others scale linearly down. */
export function heatmapIntensity(amount: number, maxAmount: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || maxAmount <= 0) return 0
  return Math.min(1, amount / maxAmount)
}

export function maxStagedAmount(amounts: readonly number[]): number {
  let max = 0
  for (const a of amounts) {
    if (Number.isFinite(a) && a > max) max = a
  }
  return max
}

export function cellState(params: {
  periodKey: string
  tx0PeriodKey: string | null
  amount: number
}): CellVisualState {
  const { periodKey, tx0PeriodKey, amount } = params
  if (tx0PeriodKey && periodKey < tx0PeriodKey) return "preHistory"
  if (tx0PeriodKey && periodKey === tx0PeriodKey) return "tx0"
  if (amount > 0) return "shaded"
  return "empty"
}

export function summarizeImportEntries(
  entries: readonly IncomeImportEntry[],
  existingByPeriod: ReadonlyMap<string, number>,
): ImportSummary {
  const rows: PeriodDiff[] = []
  let totalExisting = 0
  let totalPending = 0

  for (const entry of entries) {
    const existingAmount = existingByPeriod.get(entry.periodKey) ?? 0
    const newAmount = entry.amount
    rows.push({
      periodKey: entry.periodKey,
      newAmount,
      existingAmount,
      delta: newAmount - existingAmount,
    })
    totalExisting += existingAmount
    totalPending += newAmount
  }

  return {
    rows,
    totalExisting,
    totalPending,
    totalCombined: totalPending,
  }
}

export function p95MaxAmount(amounts: readonly number[]): number {
  const positive = amounts.filter((a) => a > 0).sort((a, b) => a - b)
  if (positive.length === 0) return 0
  const idx = Math.min(positive.length - 1, Math.floor((positive.length - 1) * 0.95))
  return positive[idx]!
}
