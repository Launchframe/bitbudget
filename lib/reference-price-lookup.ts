import { transactionCalendarDay } from "@/lib/transaction-dates"

export interface ReferencePricePoint {
  date: string
  price: number
}

/**
 * Lookup a USD mark from a sorted daily series.
 *
 * - Exact day hit → that close.
 * - Otherwise nearest earlier close (walk history ascending).
 * - When `allowBeforeFirst` is false (XBT), dates before the first candle return 0
 *   so Opportunity Cost stays blank — never invent a mark from a later listing day
 *   and never fall back to another asset’s series.
 * - When `allowBeforeFirst` is true (BTC), pre-history dates use the earliest close
 *   (legacy CoinCap behavior).
 */
export function priceOnDateFromHistory(
  date: string,
  priceMap: Record<string, number>,
  priceHistory: ReferencePricePoint[],
  currentPrice: number | null,
  options: { allowBeforeFirst: boolean },
): number {
  const d = transactionCalendarDay(date)
  if (priceMap[d]) return priceMap[d]

  const first = priceHistory[0]
  if (!first) return currentPrice ?? 0
  if (!options.allowBeforeFirst && d < first.date) return 0

  let closest = options.allowBeforeFirst ? first.price : 0
  for (const point of priceHistory) {
    if (point.date <= d) closest = point.price
    else break
  }
  return closest
}
