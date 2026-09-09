import type { Transaction } from "@/lib/data"
import {
  TX_SOURCE_FUNDING_IN,
  TX_SOURCE_FUNDING_OUT,
  TX_SOURCE_INCOME_IMPORT,
  TX_SOURCE_IRREGULAR_INCOME,
  TX_SOURCE_RETRO_PAYCHECK,
} from "@/lib/constants"
import { isUserFacingExpense, todayUtcIso, txnIsoDate } from "@/lib/transaction-visibility"
import {
  isShoppingCashInflow,
  isShoppingCashOutflow,
  isShoppingManagedSource,
} from "@/lib/shopping-classification"

const SATS_PER_BTC = 100_000_000

export interface DashboardChartPoint {
  date: string
  /** Cumulative USD (net cash flow or savings inflows depending on series). */
  spent: number
  btcValue: number
}

function txnDay(txn: Transaction): string {
  return txnIsoDate(txn.date)
}

/**
 * External cash inflows for the dashboard cash-flow chart.
 * Excludes paycheck credits — those are ledger allocations from Monthly Income, not
 * separate deposits — and all funding legs / sweeps.
 */
export const CASH_INFLOW_SOURCES = new Set([
  TX_SOURCE_IRREGULAR_INCOME,
  TX_SOURCE_RETRO_PAYCHECK,
  TX_SOURCE_INCOME_IMPORT,
  "manual",
  "plaid",
  "email_forward",
  "email_scan",
  "sms",
  "receipt_scan",
  "voice",
])

function usdToSats(usd: number, btcPrice: number): number {
  if (btcPrice <= 0) return 0
  return Math.round((usd / btcPrice) * SATS_PER_BTC)
}

export function isCashInflowCredit(txn: Pick<Transaction, "type" | "source" | "excludeFromMainHistory">): boolean {
  if (txn.type !== "credit" || txn.excludeFromMainHistory) return false
  if (isShoppingCashInflow(txn)) return true
  const src = txn.source ?? "manual"
  return CASH_INFLOW_SOURCES.has(src)
}

export function isCashOutflowExpense(txn: Pick<Transaction, "type" | "excludeFromMainHistory" | "source">): boolean {
  if (isShoppingManagedSource(txn.source)) return isShoppingCashOutflow(txn)
  return isUserFacingExpense(txn)
}

/** Signed USD delta per day from external cash inflows and outflows. */
export function buildDailyCashFlowDeltas(transactions: readonly Transaction[]): Map<string, number> {
  const daily = new Map<string, number>()
  for (const txn of transactions) {
    const day = txnDay(txn)
    if (isCashInflowCredit(txn)) {
      daily.set(day, (daily.get(day) ?? 0) + txn.amount)
    } else if (isCashOutflowExpense(txn)) {
      daily.set(day, (daily.get(day) ?? 0) - txn.amount)
    }
  }
  return daily
}

/** Cumulative net cash flow (inflows − outflows), USD only. */
export function buildCumulativeCashFlowSeries(params: {
  transactions: readonly Transaction[]
  startDate: string
  todayIso?: string
}): DashboardChartPoint[] {
  const today = params.todayIso ?? todayUtcIso()
  const daily = buildDailyCashFlowDeltas(params.transactions)
  const txnDays = [...daily.keys()].filter((d) => d >= params.startDate && d <= today).sort()
  if (txnDays.length === 0) return []

  let cumUsd = 0
  return txnDays.map((day) => {
    cumUsd += daily.get(day) ?? 0
    return { date: day, spent: Math.round(cumUsd), btcValue: 0 }
  })
}

/** Cumulative Savings inflows (credits to Savings), starting at account creation. */
export function buildCumulativeSavingsInflowSeries(params: {
  transactions: readonly Transaction[]
  savingsEnvelopeId: string
  startDate: string
  todayIso?: string
  isInflow: (txn: Transaction, savingsEnvelopeId: string) => boolean
  getPriceOnDate?: (date: string) => number
  priceHistory?: readonly { date: string }[]
}): DashboardChartPoint[] {
  const { transactions, savingsEnvelopeId, startDate, isInflow, getPriceOnDate, priceHistory } = params

  const today = params.todayIso ?? todayUtcIso()

  const credits = transactions
    .filter((t) => isInflow(t, savingsEnvelopeId) && txnDay(t) >= startDate && txnDay(t) <= today)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (credits.length === 0) return []

  const dailyUsd = new Map<string, number>()
  const dailySats = new Map<string, number>()
  for (const txn of credits) {
    const day = txnDay(txn)
    dailyUsd.set(day, (dailyUsd.get(day) ?? 0) + txn.amount)
    if (getPriceOnDate) {
      const sats =
        txn.satsAmount != null
          ? txn.satsAmount
          : usdToSats(txn.amount, getPriceOnDate(day))
      dailySats.set(day, (dailySats.get(day) ?? 0) + sats)
    }
  }

  const txnDays = [...dailyUsd.keys()].filter((d) => d <= today).sort()
  const firstTxnDate = txnDays[0]!
  if (!firstTxnDate) return []

  if (!getPriceOnDate || !priceHistory?.length) {
    let cumUsd = 0
    return txnDays.map((day) => {
      cumUsd += dailyUsd.get(day) ?? 0
      return { date: day, spent: Math.round(cumUsd), btcValue: 0 }
    })
  }

  const priceDates = priceHistory
    .filter((p) => p.date >= firstTxnDate && p.date <= today)
    .map((p) => p.date)
  const allDates = [...new Set([...priceDates, ...txnDays])].filter((d) => d <= today).sort()

  let cumUsd = 0
  let cumSats = 0
  let txnIdx = 0
  const points: DashboardChartPoint[] = []

  for (const day of allDates) {
    while (txnIdx < txnDays.length && txnDays[txnIdx]! <= day) {
      cumUsd += dailyUsd.get(txnDays[txnIdx]!) ?? 0
      cumSats += dailySats.get(txnDays[txnIdx]!) ?? 0
      txnIdx++
    }
    const priceOnDay = getPriceOnDate(day)
    const btcValue = (cumSats / SATS_PER_BTC) * priceOnDay
    points.push({ date: day, spent: Math.round(cumUsd), btcValue: Math.round(btcValue) })
  }

  return points
}

/** Internal ledger legs that do not represent external cash movement. */
export function isInternalLedgerSource(source: string | undefined | null): boolean {
  const src = source ?? "manual"
  return src === TX_SOURCE_FUNDING_IN || src === TX_SOURCE_FUNDING_OUT || src === "envelope_sweep"
}
