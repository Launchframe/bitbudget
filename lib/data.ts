// ─── Types ───────────────────────────────────────────────────────────

export type TransactionType = "expense" | "credit"

export type TransactionSource = "manual" | "voice" | "receipt_scan" | "sms" | "email_forward" | "email_scan" | "plaid"

export interface Transaction {
  id: string
  date: string // ISO date string YYYY-MM-DD
  payee: string
  amount: number
  type: TransactionType
  envelopeId: string
  tags: string[]
  notes?: string | null
  satsAmount?: number | null
  recurringId?: string | null
  source?: TransactionSource
  /** Server row version for delta sync (ISO 8601). */
  updatedAt?: string
  /** Client: false when payee/notes are not shown in cleartext (locked or pending decrypt). */
  isDecrypted?: boolean
}

export interface PendingTransaction {
  id: string
  source: TransactionSource
  payee: string
  amount: number
  date: string
  notes?: string | null
  suggestedEnvelopeId: string | null
  confidence: number
  rawInput?: string | null
  tags?: string | null
  createdAt: string
}

export interface Envelope {
  id: string
  name: string
  monthlyAllotment: number
  color: string
  icon?: string | null
  archived?: boolean
}

export interface Tag {
  id: string
  name: string
}

export type BtcDisplayUnit = "sats" | "btc"

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual"

export interface RecurringTransaction {
  id: string
  payee: string
  amount: number
  type: TransactionType
  envelopeId: string
  envelopeName: string
  envelopeColor: string
  cadence: Cadence
  tags: string[]
  nextDueDate: string // YYYY-MM-DD
  endDate: string | null
  active: boolean
  createdAt: string
  notes: string | null
  /** Client: false when payee/notes are not shown in cleartext (locked or pending decrypt). */
  isDecrypted?: boolean
}

export interface AppState {
  transactions: Transaction[]
  envelopes: Envelope[]
  tags: Tag[]
  monthlyIncome: number
  btcDisplayUnit: BtcDisplayUnit
  opportunityCostEnabled: boolean
}

// ─── Mock BTC Price Data (client-side fallback) ─────────────────────

interface BtcPricePoint {
  date: string
  price: number
}

function generateBtcPriceHistory(): BtcPricePoint[] {
  const points: BtcPricePoint[] = []
  const startDate = new Date("2024-01-01")
  const endDate = new Date("2026-02-28")

  const keyPrices: Record<string, number> = {
    "2024-01": 42000, "2024-02": 43500, "2024-03": 63000, "2024-04": 64500,
    "2024-05": 68000, "2024-06": 65000, "2024-07": 58000, "2024-08": 59000,
    "2024-09": 63500, "2024-10": 67000, "2024-11": 90000, "2024-12": 97000,
    "2025-01": 102000, "2025-02": 96000, "2025-03": 85000, "2025-04": 93000,
    "2025-05": 107000, "2025-06": 108000, "2025-07": 100000, "2025-08": 95000,
    "2025-09": 98000, "2025-10": 102000, "2025-11": 108000, "2025-12": 96000,
    "2026-01": 103000, "2026-02": 110000,
  }

  let currentPrice = 42000
  const current = new Date(startDate)

  while (current <= endDate) {
    const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`
    const targetPrice = keyPrices[monthKey] || currentPrice

    const drift = (targetPrice - currentPrice) * 0.05
    const noise = (Math.random() - 0.5) * currentPrice * 0.025
    currentPrice = Math.max(20000, currentPrice + drift + noise)

    points.push({
      date: current.toISOString().split("T")[0],
      price: Math.round(currentPrice),
    })

    current.setDate(current.getDate() + 1)
  }

  return points
}

let _priceCache: BtcPricePoint[] | null = null

export function getBtcPriceHistory(): BtcPricePoint[] {
  if (!_priceCache) {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("btc-price-history")
      if (cached) {
        _priceCache = JSON.parse(cached)
      } else {
        _priceCache = generateBtcPriceHistory()
        sessionStorage.setItem("btc-price-history", JSON.stringify(_priceCache))
      }
    } else {
      _priceCache = generateBtcPriceHistory()
    }
  }
  return _priceCache!
}

export function getBtcPriceOnDate(date: string): number {
  const history = getBtcPriceHistory()
  const targetDate = date.split("T")[0]

  let closest = history[0]
  for (const point of history) {
    if (point.date <= targetDate) {
      closest = point
    } else {
      break
    }
  }
  return closest.price
}

export function getCurrentBtcPrice(): number {
  const history = getBtcPriceHistory()
  return history[history.length - 1].price
}

export function calculateOpportunityCost(amount: number, date: string): number {
  const priceOnDate = getBtcPriceOnDate(date)
  const btcAmount = amount / priceOnDate
  const currentPrice = getCurrentBtcPrice()
  return btcAmount * currentPrice
}

export function satsPerDollar(btcPrice: number): number {
  return Math.round(100_000_000 / btcPrice)
}

export function formatUsd(amount: number, fractionDigits: number = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
}

export function formatUsdPrecise(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatSats(sats: number): string {
  return formatSatsInteger(sats) + " sats"
}

/** Integer sats count with grouping (no unit prefix; use {@link FormattedBtcAmountFromSats} in UI for the symbol). */
export function formatSatsInteger(sats: number): string {
  return new Intl.NumberFormat("en-US").format(sats)
}

export const SATS_PER_BTC = 100_000_000

function formatBtcFixed(btcValue: number, displayUnit: boolean = true): string {
  const s = btcValue.toFixed(8)
  // Insert a space before the last 4 decimal digits: 0.00000000 → 0.0000 0000
  return (displayUnit ? "₿" : "") + s.slice(0, -4) + "\u2009" + s.slice(-4)
}

export function formatBtcAmount(btcValue: number, unit: BtcDisplayUnit, displayUnit: boolean = true): string {
  if (unit === "sats") {
    const sats = Math.round(btcValue * SATS_PER_BTC)
    return formatSatsInteger(sats)
  }
  return formatBtcFixed(btcValue, displayUnit)
}

export function formatBtcAmountFromSats(sats: number, unit: BtcDisplayUnit, displayUnit: boolean = true): string {
  if (unit === "sats") {
    return formatSatsInteger(sats)
  }
  return formatBtcFixed(sats / SATS_PER_BTC, displayUnit)
}


export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n)
}

// ─── Default State (empty for API-backed mode) ─────────────────────

export function getDefaultState(): AppState {
  return {
    transactions: [],
    envelopes: [],
    tags: [],
    monthlyIncome: 0,
    btcDisplayUnit: "sats",
    opportunityCostEnabled: false,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function getMonthKey(date: string): string {
  return date.slice(0, 7)
}

export function getCurrentMonthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

export function getTransactionsForEnvelope(
  transactions: Transaction[],
  envelopeId: string,
  monthKey?: string,
): Transaction[] {
  return transactions.filter(
    t =>
      t.envelopeId === envelopeId &&
      (monthKey ? getMonthKey(t.date) === monthKey : true),
  )
}

export function getEnvelopeBalance(
  transactions: Transaction[],
  envelopeId: string,
  monthKey: string,
  allotment: number,
): number {
  const monthTxns = getTransactionsForEnvelope(transactions, envelopeId, monthKey)
  const expenses = monthTxns.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)
  const credits = monthTxns.filter(t => t.type === "credit").reduce((sum, t) => sum + t.amount, 0)
  return allotment - expenses + credits
}
