// ─── Types ───────────────────────────────────────────────────────────

export type TransactionType = "expense" | "credit"

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
}

export interface Envelope {
  id: string
  name: string
  monthlyAllotment: number
  color: string
  icon?: string | null
}

export type BtcDisplayUnit = "sats" | "btc"

export interface AppState {
  transactions: Transaction[]
  envelopes: Envelope[]
  tags: string[]
  monthlyIncome: number
  btcDisplayUnit: BtcDisplayUnit
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

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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
  return new Intl.NumberFormat("en-US").format(sats) + " sats"
}

const SATS_PER_BTC = 100_000_000

export function formatBtcAmount(btcValue: number, unit: BtcDisplayUnit): string {
  if (unit === "sats") {
    const sats = Math.round(btcValue * SATS_PER_BTC)
    return new Intl.NumberFormat("en-US").format(sats) + " sats"
  }
  return btcValue.toFixed(8) + " BTC"
}

export function formatBtcAmountFromSats(sats: number, unit: BtcDisplayUnit): string {
  if (unit === "sats") {
    return new Intl.NumberFormat("en-US").format(sats) + " sats"
  }
  return (sats / SATS_PER_BTC).toFixed(8) + " BTC"
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n)
}

// ─── Default State (empty for API-backed mode) ─────────────────────

const DEFAULT_TAGS = ["Essential", "Discretionary", "Recurring"]

export function getDefaultState(): AppState {
  return {
    transactions: [],
    envelopes: [],
    tags: DEFAULT_TAGS,
    monthlyIncome: 0,
    btcDisplayUnit: "sats",
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
