import { TX_SOURCE_INCOME_IMPORT } from "@/lib/constants"
import { TX_SOURCE_FUNDING_IN, TX_SOURCE_FUNDING_OUT } from "@/lib/envelope-funding"

export type PeriodKey = string

export interface Tx0Result {
  year: number
  month: number
  periodKey: PeriodKey
}

const EXCLUDED_SOURCES = new Set([
  TX_SOURCE_INCOME_IMPORT,
  TX_SOURCE_FUNDING_IN,
  TX_SOURCE_FUNDING_OUT,
])

interface TxLike {
  date: string
  type: string
  source?: string | null
  excludeFromMainHistory?: boolean
}

/**
 * Earliest non-import, non-funding-leg credit — the user's real transaction history start.
 * Re-imports never push Tx0 backward.
 */
export function findTransactionHistoryStart(transactions: readonly TxLike[]): Tx0Result | null {
  let earliest: string | null = null

  for (const t of transactions) {
    if (t.type !== "credit" || t.excludeFromMainHistory) continue
    const src = t.source ?? "manual"
    if (EXCLUDED_SOURCES.has(src)) continue
    const day = t.date.split("T")[0]!
    if (earliest == null || day < earliest) earliest = day
  }

  if (!earliest) return null
  const [y, m] = earliest.split("-").map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null
  return {
    year: y,
    month: m,
    periodKey: `${y}-${String(m).padStart(2, "0")}`,
  }
}
