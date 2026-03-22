/** Parse YYYY-MM-DD at local noon to avoid DST / UTC off-by-one on axis ticks. */
export function parseIsoDateLocal(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00`)
}

export function daysBetweenIsoInclusiveRange(a: string, b: string): number {
  return Math.round(
    (parseIsoDateLocal(b).getTime() - parseIsoDateLocal(a).getTime()) / 86_400_000,
  )
}

export type ExpenseChartRangeKey = "mtd" | "1m" | "3m" | "12m" | "ytd" | "5y" | "all"

/**
 * X-axis tick labels for the dashboard expense / opportunity-cost chart.
 * - Presets 12M and shorter: month + day (with 2-digit year when the tick is not in the last data year).
 * - 5Y / All: same as above when actual data spans ≤ ~27 months; otherwise month + 2-digit year (no year-only).
 */
export function formatExpenseChartXAxisTick(
  isoDate: string,
  args: {
    activeRange: ExpenseChartRangeKey
    dataFirstIso: string
    dataLastIso: string
  },
): string {
  const d = parseIsoDateLocal(isoDate)
  const spanDays = daysBetweenIsoInclusiveRange(args.dataFirstIso, args.dataLastIso)
  const endYear = parseIsoDateLocal(args.dataLastIso).getFullYear()

  const shortPreset =
    args.activeRange === "mtd" ||
    args.activeRange === "1m" ||
    args.activeRange === "3m" ||
    args.activeRange === "12m" ||
    args.activeRange === "ytd"

  /** Long window but history is still “short” — avoid repeating bare years. */
  const useMonthDayStyle = shortPreset || spanDays <= 800

  if (useMonthDayStyle) {
    if (d.getFullYear() === endYear) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    }
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "2-digit",
    })
  }

  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
}
