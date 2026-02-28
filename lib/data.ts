// ─── Types ───────────────────────────────────────────────────────────

export type TransactionType = "expense" | "credit"

export interface Transaction {
  id: string
  date: string // ISO date string YYYY-MM-DD
  payee: string // Payee for expenses, Payer for credits
  amount: number // USD amount (always positive)
  type: TransactionType
  envelopeId: string
  tags: string[]
}

export interface Envelope {
  id: string
  name: string
  monthlyAllotment: number
  color: string
}

export interface AppState {
  transactions: Transaction[]
  envelopes: Envelope[]
  tags: string[]
  monthlyIncome: number
}

// ─── Mock BTC Price Data ─────────────────────────────────────────────

interface BtcPricePoint {
  date: string // YYYY-MM-DD
  price: number
}

function generateBtcPriceHistory(): BtcPricePoint[] {
  const points: BtcPricePoint[] = []
  const startDate = new Date("2024-01-01")
  const endDate = new Date("2026-02-28")

  // Realistic BTC trajectory: ~42k Jan 2024 -> ~100k Dec 2024 -> ~120k mid 2025 -> ~95k late 2025 -> ~110k Feb 2026
  const keyPrices: Record<string, number> = {
    "2024-01": 42000,
    "2024-02": 43500,
    "2024-03": 63000,
    "2024-04": 64500,
    "2024-05": 68000,
    "2024-06": 65000,
    "2024-07": 58000,
    "2024-08": 59000,
    "2024-09": 63500,
    "2024-10": 67000,
    "2024-11": 90000,
    "2024-12": 97000,
    "2025-01": 102000,
    "2025-02": 96000,
    "2025-03": 85000,
    "2025-04": 93000,
    "2025-05": 107000,
    "2025-06": 108000,
    "2025-07": 100000,
    "2025-08": 95000,
    "2025-09": 98000,
    "2025-10": 102000,
    "2025-11": 108000,
    "2025-12": 96000,
    "2026-01": 103000,
    "2026-02": 110000,
  }

  let currentPrice = 42000
  const current = new Date(startDate)

  while (current <= endDate) {
    const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`
    const targetPrice = keyPrices[monthKey] || currentPrice

    // Gradually move toward target with daily noise
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

// Cache the generated data so it's consistent within a session
let _priceCache: BtcPricePoint[] | null = null

export function getBtcPriceHistory(): BtcPricePoint[] {
  if (!_priceCache) {
    // Try to load from sessionStorage for consistency
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

  // Find exact match or closest earlier date
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

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n)
}

// ─── Seed Data ───────────────────────────────────────────────────────

const DEFAULT_ENVELOPES: Envelope[] = [
  { id: "env-rent", name: "Rent", monthlyAllotment: 1500, color: "#F7931A" },
  { id: "env-utilities", name: "Utilities", monthlyAllotment: 200, color: "#3B82F6" },
  { id: "env-food", name: "Food", monthlyAllotment: 600, color: "#10B981" },
  { id: "env-entertainment", name: "Entertainment", monthlyAllotment: 300, color: "#8B5CF6" },
  { id: "env-transportation", name: "Transportation", monthlyAllotment: 400, color: "#EF4444" },
]

const DEFAULT_TAGS = ["Essential", "Discretionary", "Recurring"]

function generateSeedTransactions(): Transaction[] {
  const payees: Record<string, string[]> = {
    "env-rent": ["Landlord", "Property Management Co"],
    "env-utilities": ["Electric Company", "Water Works", "Internet Provider", "Gas Company"],
    "env-food": ["Whole Foods", "Trader Joe's", "Chipotle", "Local Diner", "Pizza Place", "Costco"],
    "env-entertainment": ["Netflix", "Spotify", "AMC Theaters", "Steam", "Concert Tickets"],
    "env-transportation": ["Shell Gas", "Uber", "City Parking", "Auto Insurance", "Oil Change"],
  }

  const transactions: Transaction[] = []
  const now = new Date("2026-02-28")

  // Generate transactions over the past 6 months
  for (let monthsBack = 0; monthsBack < 6; monthsBack++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1)

    // Monthly income credit
    transactions.push({
      id: `txn-income-${monthsBack}`,
      date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).toISOString().split("T")[0],
      payee: "Employer Direct Deposit",
      amount: 5000,
      type: "credit",
      envelopeId: "env-rent", // Income typically deposited
      tags: ["Recurring"],
    })

    // Rent expense (1st of each month)
    transactions.push({
      id: `txn-rent-${monthsBack}`,
      date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).toISOString().split("T")[0],
      payee: payees["env-rent"][monthsBack % 2],
      amount: 1500,
      type: "expense",
      envelopeId: "env-rent",
      tags: ["Essential", "Recurring"],
    })

    // Utility expenses
    const utilPayees = payees["env-utilities"]
    for (let i = 0; i < 2; i++) {
      transactions.push({
        id: `txn-util-${monthsBack}-${i}`,
        date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 5 + i * 10).toISOString().split("T")[0],
        payee: utilPayees[(monthsBack + i) % utilPayees.length],
        amount: 50 + Math.round(Math.random() * 80),
        type: "expense",
        envelopeId: "env-utilities",
        tags: ["Essential", "Recurring"],
      })
    }

    // Food expenses (several per month)
    const foodPayees = payees["env-food"]
    for (let i = 0; i < 4; i++) {
      transactions.push({
        id: `txn-food-${monthsBack}-${i}`,
        date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 3 + i * 7).toISOString().split("T")[0],
        payee: foodPayees[(monthsBack + i) % foodPayees.length],
        amount: 30 + Math.round(Math.random() * 120),
        type: "expense",
        envelopeId: "env-food",
        tags: i < 2 ? ["Essential"] : ["Discretionary"],
      })
    }

    // Entertainment
    const entPayees = payees["env-entertainment"]
    for (let i = 0; i < 2; i++) {
      transactions.push({
        id: `txn-ent-${monthsBack}-${i}`,
        date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 8 + i * 12).toISOString().split("T")[0],
        payee: entPayees[(monthsBack + i) % entPayees.length],
        amount: 10 + Math.round(Math.random() * 100),
        type: "expense",
        envelopeId: "env-entertainment",
        tags: ["Discretionary"],
      })
    }

    // Transportation
    const transPayees = payees["env-transportation"]
    for (let i = 0; i < 2; i++) {
      transactions.push({
        id: `txn-trans-${monthsBack}-${i}`,
        date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 10 + i * 10).toISOString().split("T")[0],
        payee: transPayees[(monthsBack + i) % transPayees.length],
        amount: 40 + Math.round(Math.random() * 160),
        type: "expense",
        envelopeId: "env-transportation",
        tags: i === 0 ? ["Essential"] : ["Discretionary"],
      })
    }
  }

  return transactions.sort((a, b) => b.date.localeCompare(a.date))
}

// ─── localStorage Persistence ────────────────────────────────────────

const STORAGE_KEY = "bitbudget-state"

export function getDefaultState(): AppState {
  return {
    transactions: generateSeedTransactions(),
    envelopes: DEFAULT_ENVELOPES,
    tags: DEFAULT_TAGS,
    monthlyIncome: 5000,
  }
}

export function loadState(): AppState {
  if (typeof window === "undefined") return getDefaultState()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as AppState
    }
  } catch {
    // ignore parse errors
  }
  const defaultState = getDefaultState()
  saveState(defaultState)
  return defaultState
}

export function saveState(state: AppState): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore quota errors
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function getMonthKey(date: string): string {
  return date.slice(0, 7) // "YYYY-MM"
}

export function getCurrentMonthKey(): string {
  return "2026-02" // Fixed "current" month for mock data consistency
}

export function getTransactionsForEnvelope(
  transactions: Transaction[],
  envelopeId: string,
  monthKey?: string
): Transaction[] {
  return transactions.filter(
    (t) =>
      t.envelopeId === envelopeId &&
      (monthKey ? getMonthKey(t.date) === monthKey : true)
  )
}

export function getEnvelopeBalance(
  transactions: Transaction[],
  envelopeId: string,
  monthKey: string,
  allotment: number
): number {
  const monthTxns = getTransactionsForEnvelope(transactions, envelopeId, monthKey)
  const expenses = monthTxns
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0)
  const credits = monthTxns
    .filter((t) => t.type === "credit")
    .reduce((sum, t) => sum + t.amount, 0)
  return allotment - expenses + credits
}
