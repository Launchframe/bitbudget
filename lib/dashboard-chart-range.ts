import { todayUtcIso, txnIsoDate } from "@/lib/transaction-visibility"
import type { ExpenseChartRangeKey } from "@/lib/chart-x-axis-format"

export type DashboardChartRangeKey = ExpenseChartRangeKey | "custom"

export interface DashboardChartRange {
  activeRange: DashboardChartRangeKey
  startDate: string
  endDate: string
}

const RANGE_EVENT = "bitbudget-dashboard-chart-range-change"

let currentRange: DashboardChartRange = {
  activeRange: "12m",
  startDate: getStartDateForRange("12m"),
  endDate: todayUtcIso(),
}

export function getStartDateForRange(key: Exclude<DashboardChartRangeKey, "custom">): string {
  const d = new Date()
  switch (key) {
    case "mtd":
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
    case "1m":
      d.setMonth(d.getMonth() - 1)
      break
    case "3m":
      d.setMonth(d.getMonth() - 3)
      break
    case "12m":
      d.setFullYear(d.getFullYear() - 1)
      break
    case "ytd":
      return `${d.getFullYear()}-01-01`
    case "5y":
      d.setFullYear(d.getFullYear() - 5)
      break
    case "all":
      return "2009-01-03"
  }
  return d.toISOString().split("T")[0]!
}

export function getDashboardChartRange(): DashboardChartRange {
  return currentRange
}

export function setDashboardChartPresetRange(key: Exclude<DashboardChartRangeKey, "custom">): void {
  currentRange = {
    activeRange: key,
    startDate: getStartDateForRange(key),
    endDate: todayUtcIso(),
  }
  dispatchRangeChange()
}

export function setDashboardChartCustomRange(startDate: string, endDate: string): void {
  const start = startDate <= endDate ? startDate : endDate
  const end = startDate <= endDate ? endDate : startDate
  currentRange = {
    activeRange: "custom",
    startDate: start,
    endDate: end,
  }
  dispatchRangeChange()
}

export function subscribeDashboardChartRange(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const handler = () => onChange()
  window.addEventListener(RANGE_EVENT, handler)
  return () => window.removeEventListener(RANGE_EVENT, handler)
}

export function transactionInDashboardChartRange(
  date: string,
  range: Pick<DashboardChartRange, "startDate" | "endDate">,
): boolean {
  const iso = txnIsoDate(date)
  return iso >= range.startDate && iso <= range.endDate
}

function dispatchRangeChange(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(RANGE_EVENT))
}
