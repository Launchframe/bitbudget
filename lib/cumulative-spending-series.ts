import type { Transaction } from "@/lib/data"
import {
  filterUserFacingExpenses,
  todayUtcIso,
  txnIsoDate,
} from "@/lib/transaction-visibility"

const SATS_PER_BTC = 100_000_000

export interface CumulativeSpendingPoint {
  date: string
  spent: number
  btcValue: number
}

function usdToSats(usd: number, btcPrice: number): number {
  if (btcPrice <= 0) return 0
  return Math.round((usd / btcPrice) * SATS_PER_BTC)
}

/**
 * Cumulative user-facing spend for dashboard OC / vanilla spending charts.
 * Excludes funding legs; never plots dates after `todayIso`.
 */
export function buildCumulativeSpendingSeries(params: {
  transactions: readonly Transaction[]
  startDate: string
  todayIso?: string
  getPriceOnDate?: (date: string) => number
  priceHistory?: readonly { date: string }[]
}): CumulativeSpendingPoint[] {
  const todayIso = params.todayIso ?? todayUtcIso()
  const expenses = filterUserFacingExpenses(params.transactions)
    .filter((t) => txnIsoDate(t.date) >= params.startDate && txnIsoDate(t.date) <= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (expenses.length === 0) return []

  const dailyTxns = new Map<string, { usd: number; sats: number }>()
  for (const txn of expenses) {
    const day = txnIsoDate(txn.date)
    const entry = dailyTxns.get(day) ?? { usd: 0, sats: 0 }
    entry.usd += txn.amount
    if (params.getPriceOnDate) {
      if (txn.satsAmount != null) {
        entry.sats += txn.satsAmount
      } else {
        const price = params.getPriceOnDate(day)
        if (price > 0) entry.sats += usdToSats(txn.amount, price)
      }
    }
    dailyTxns.set(day, entry)
  }

  const txnDays = [...dailyTxns.keys()].sort()
  const firstTxnDate = txnDays[0]!

  if (!params.getPriceOnDate || !params.priceHistory?.length) {
    let cumUsd = 0
    return txnDays.map((day) => {
      cumUsd += dailyTxns.get(day)!.usd
      return { date: day, spent: Math.round(cumUsd), btcValue: 0 }
    })
  }

  const priceDates = params.priceHistory
    .filter((p) => p.date >= firstTxnDate && p.date <= todayIso)
    .map((p) => p.date)

  const allDates = [...new Set([...priceDates, ...txnDays])]
    .filter((d) => d <= todayIso)
    .sort()

  let cumUsd = 0
  let cumSats = 0
  let txnIdx = 0
  const points: CumulativeSpendingPoint[] = []

  for (const day of allDates) {
    while (txnIdx < txnDays.length && txnDays[txnIdx]! <= day) {
      const d = dailyTxns.get(txnDays[txnIdx]!)!
      cumUsd += d.usd
      cumSats += d.sats
      txnIdx++
    }
    const priceOnDay = params.getPriceOnDate(day)
    const btcValue = (cumSats / SATS_PER_BTC) * priceOnDay
    points.push({ date: day, spent: Math.round(cumUsd), btcValue: Math.round(btcValue) })
  }

  return points
}
