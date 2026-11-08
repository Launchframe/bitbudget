import { isBudgetEnvelope } from "@/lib/constants"
import type { Envelope, Transaction } from "@/lib/data"
import { getMonthKey } from "@/lib/data"
import { isUserFacingExpense } from "@/lib/transaction-visibility"

/**
 * Pure spending-insight math for the Runway "where did it go" surface.
 *
 * No Prisma, no React — this only reads plain {@link Transaction} / {@link Envelope}
 * shapes and returns structured numbers the UI can render. It compares a window of
 * recent *complete* calendar months against the complete months immediately before
 * them, per discretionary envelope, to surface which envelopes carry the bulk of
 * spending, which ran hotter than usual, and single purchases that were much larger
 * than that envelope's typical purchase size.
 *
 * All money is in the app's canonical USD-cents-free number units (same as
 * {@link Transaction.amount}); callers format for display.
 */

/** How the user has (optionally) classified an envelope's spending. */
export type EnvelopePriority = "essential" | "flexible" | "unset"

export interface ExpenseInsightInput {
  transactions: Transaction[]
  /** May include the system Savings envelope — it is filtered out internally. */
  envelopes: Envelope[]
  /** Map envelopeId → priority; a missing entry is treated as `unset`. */
  priorities?: Record<string, EnvelopePriority>
  /** How many recent complete months to score (default 3). */
  recentMonths?: number
  /** How many prior complete months to use as the baseline (default 3). */
  baselineMonths?: number
  /** Anchor date; defaults to now (UTC). The month containing `asOf` is excluded. */
  asOf?: Date
  /** A purchase ≥ this multiple of the envelope's typical size is flagged (default 3). */
  outlierMultiple?: number
}

/** A single expense in the recent window that dwarfs the envelope's usual purchase. */
export interface OutlierPurchase {
  transactionId: string
  amount: number
  /** `YYYY-MM-DD` (or stored instant) of the purchase. */
  date: string
  payee: string
  /** Median size of the envelope's *other* purchases in the combined window. */
  typicalAmount: number
  /** `amount / typicalAmount`, e.g. 4.2 → "about 4× your usual". */
  multipleOfTypical: number
}

/** Per-envelope spending comparison for the scored window. */
export interface EnvelopeExpenseInsight {
  envelopeId: string
  envelopeName: string
  priority: EnvelopePriority
  /** Total user-facing spend in the recent complete months. */
  recentTotal: number
  /** `recentTotal` divided by `recentMonths` (complete months, so zero months pull it down). */
  recentMonthlyAvg: number
  /** Baseline average monthly spend over the prior complete months. */
  baselineMonthlyAvg: number
  /** `recentMonthlyAvg - baselineMonthlyAvg` (negative when spending cooled off). */
  dollarsAboveUsual: number
  /** Percent change vs baseline, or `null` when the baseline average is 0. */
  percentAboveUsual: number | null
  /** Envelope recent total ÷ all discretionary recent total (0..1; 0 when no spend). */
  shareOfTotalSpend: number
  /** Purchases in the recent window far larger than the envelope's typical size. */
  outlierPurchases: OutlierPurchase[]
  /**
   * Suggested dollars reclaimable by returning to the usual pace. For flexible
   * envelopes this is `max(0, dollarsAboveUsual)`; essential/unset envelopes get 0
   * (the above-usual stats are still reported).
   */
  dollarsKeptIfReturnedToUsual: number
}

export interface ExpenseInsightResult {
  /** Recent complete month keys, newest first (`YYYY-MM`). */
  recentMonthKeys: string[]
  /** Baseline complete month keys, newest first (`YYYY-MM`). */
  baselineMonthKeys: string[]
  /** Total discretionary user-facing spend across the recent complete months. */
  totalRecentDiscretionarySpend: number
  /** Every discretionary envelope with any spend in the combined window. */
  envelopes: EnvelopeExpenseInsight[]
  /** Envelopes sorted by `shareOfTotalSpend` descending (the bulk of spending). */
  bySpendShare: EnvelopeExpenseInsight[]
  /** Envelopes sorted by `dollarsAboveUsual` descending (which ran hot). */
  byAboveUsual: EnvelopeExpenseInsight[]
  /** Sum of `dollarsKeptIfReturnedToUsual` across flexible envelopes. */
  totalDollarsKeptIfFlexibleReturned: number
}

/** UTC month key (`YYYY-MM`) for `asOf` shifted back `monthsBack` whole months. */
function monthKeyOffset(asOf: Date, monthsBack: number): string {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - monthsBack, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function computeExpenseInsight(input: ExpenseInsightInput): ExpenseInsightResult {
  const {
    transactions,
    envelopes,
    priorities = {},
    asOf = new Date(),
    outlierMultiple = 3,
  } = input

  const recentMonths = Math.max(0, Math.floor(input.recentMonths ?? 3))
  const baselineMonths = Math.max(0, Math.floor(input.baselineMonths ?? 3))

  // Recent = the N complete months ending just before the (incomplete) month of asOf.
  const recentMonthKeys: string[] = []
  for (let i = 1; i <= recentMonths; i++) recentMonthKeys.push(monthKeyOffset(asOf, i))
  // Baseline = the M complete months immediately before the recent window.
  const baselineMonthKeys: string[] = []
  for (let i = recentMonths + 1; i <= recentMonths + baselineMonths; i++) {
    baselineMonthKeys.push(monthKeyOffset(asOf, i))
  }

  const recentSet = new Set(recentMonthKeys)
  const baselineSet = new Set(baselineMonthKeys)

  // Discretionary envelopes only (exclude the system Savings envelope).
  const discretionary = envelopes.filter((e) => isBudgetEnvelope(e.systemRole))
  const envById = new Map(discretionary.map((e) => [e.id, e]))

  // Per-envelope accumulators.
  const recentTotalById = new Map<string, number>()
  const baselineTotalById = new Map<string, number>()
  // All purchases in the combined window, kept for median + outlier scanning.
  const recentPurchasesById = new Map<string, Transaction[]>()
  const windowPurchaseAmountsById = new Map<string, number[]>()

  for (const t of transactions) {
    if (!isUserFacingExpense(t)) continue
    if (!envById.has(t.envelopeId)) continue
    const mk = getMonthKey(t.date)
    const inRecent = recentSet.has(mk)
    const inBaseline = baselineSet.has(mk)
    if (!inRecent && !inBaseline) continue

    const amounts = windowPurchaseAmountsById.get(t.envelopeId) ?? []
    amounts.push(t.amount)
    windowPurchaseAmountsById.set(t.envelopeId, amounts)

    if (inRecent) {
      recentTotalById.set(t.envelopeId, (recentTotalById.get(t.envelopeId) ?? 0) + t.amount)
      const rp = recentPurchasesById.get(t.envelopeId) ?? []
      rp.push(t)
      recentPurchasesById.set(t.envelopeId, rp)
    } else {
      baselineTotalById.set(t.envelopeId, (baselineTotalById.get(t.envelopeId) ?? 0) + t.amount)
    }
  }

  const totalRecentDiscretionarySpend = Array.from(recentTotalById.values()).reduce(
    (a, b) => a + b,
    0,
  )

  const envelopesWithSpend = new Set<string>([
    ...recentTotalById.keys(),
    ...baselineTotalById.keys(),
  ])

  const results: EnvelopeExpenseInsight[] = []

  for (const envelopeId of envelopesWithSpend) {
    const env = envById.get(envelopeId)!
    const priority = priorities[envelopeId] ?? "unset"

    const recentTotal = recentTotalById.get(envelopeId) ?? 0
    const baselineTotal = baselineTotalById.get(envelopeId) ?? 0
    const recentMonthlyAvg = recentMonths > 0 ? recentTotal / recentMonths : 0
    const baselineMonthlyAvg = baselineMonths > 0 ? baselineTotal / baselineMonths : 0
    const dollarsAboveUsual = recentMonthlyAvg - baselineMonthlyAvg
    const percentAboveUsual =
      baselineMonthlyAvg === 0 ? null : (dollarsAboveUsual / baselineMonthlyAvg) * 100
    const shareOfTotalSpend =
      totalRecentDiscretionarySpend > 0 ? recentTotal / totalRecentDiscretionarySpend : 0

    // Outliers: recent-window purchases far larger than the envelope's typical size.
    const allWindowAmounts = windowPurchaseAmountsById.get(envelopeId) ?? []
    const recentPurchases = recentPurchasesById.get(envelopeId) ?? []
    const outlierPurchases: OutlierPurchase[] = []
    for (const purchase of recentPurchases) {
      // Typical = median of the envelope's OTHER purchases in the combined window.
      const others: number[] = []
      let skippedSelf = false
      for (const amt of allWindowAmounts) {
        if (!skippedSelf && amt === purchase.amount) {
          skippedSelf = true
          continue
        }
        others.push(amt)
      }
      const typicalAmount = median(others)
      if (typicalAmount <= 0) continue
      if (purchase.amount >= outlierMultiple * typicalAmount) {
        outlierPurchases.push({
          transactionId: purchase.id,
          amount: purchase.amount,
          date: purchase.date,
          payee: purchase.payee,
          typicalAmount,
          multipleOfTypical: purchase.amount / typicalAmount,
        })
      }
    }
    outlierPurchases.sort((a, b) => b.amount - a.amount)

    const dollarsKeptIfReturnedToUsual =
      priority === "flexible" ? Math.max(0, dollarsAboveUsual) : 0

    results.push({
      envelopeId,
      envelopeName: env.name,
      priority,
      recentTotal,
      recentMonthlyAvg,
      baselineMonthlyAvg,
      dollarsAboveUsual,
      percentAboveUsual,
      shareOfTotalSpend,
      outlierPurchases,
      dollarsKeptIfReturnedToUsual,
    })
  }

  const bySpendShare = [...results].sort((a, b) => b.shareOfTotalSpend - a.shareOfTotalSpend)
  const byAboveUsual = [...results].sort((a, b) => b.dollarsAboveUsual - a.dollarsAboveUsual)
  const totalDollarsKeptIfFlexibleReturned = results.reduce(
    (sum, r) => sum + r.dollarsKeptIfReturnedToUsual,
    0,
  )

  return {
    recentMonthKeys,
    baselineMonthKeys,
    totalRecentDiscretionarySpend,
    envelopes: results,
    bySpendShare,
    byAboveUsual,
    totalDollarsKeptIfFlexibleReturned,
  }
}
