import type { CommunicationPreferences } from "./communication-preferences"
import { transactionCalendarDay } from "@/lib/transaction-dates"

export type { CommunicationPreferenceKey, CommunicationPreferences } from "./communication-preferences"

// ─── Types ───────────────────────────────────────────────────────────

export type TransactionType = "expense" | "credit"

export type TransactionSource =
  | "manual"
  | "voice"
  | "receipt_scan"
  | "sms"
  | "notification_forward"
  | "email_forward"
  | "email_scan"
  | "plaid"
  | "paycheck"
  | "retro_paycheck"
  | "irregular_income"
  | "envelope_funding_out"
  | "envelope_funding_in"
  | "income_import"
  | "envelope_sweep"
  | "csv_import"
  | "statement_import"
  | "deficit_cover"
  | "envelope_transfer_in"
  | "envelope_transfer_out"

export interface Transaction {
  id: string
  /** Calendar `YYYY-MM-DD` or full ISO 8601 when a capture timestamp is stored. */
  date: string
  payee: string
  amount: number
  type: TransactionType
  envelopeId: string
  tags: string[]
  notes?: string | null
  satsAmount?: number | null
  recurringId?: string | null
  source?: TransactionSource
  /** Funding allocation legs hidden from global transaction lists */
  excludeFromMainHistory?: boolean
  fundingBatchId?: string | null
  fundingBatchPeriodKey?: string | null
  fundingBatchKind?: string | null
  /** Server creation timestamp for ordering same-day transactions. */
  createdAt?: string
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
  /** Server: system-managed Savings envelope (always present after first session) */
  systemRole?: string | null
  sweepPolicy?: string
  sweepCapMultiplier?: number | null
  /** ISO date (YYYY-MM-DD) when the envelope was created — used as the balance genesis floor. */
  createdAt?: string
  /** ISO timestamp when soft-deleted; transactions are excluded from the ledger until restore or purge. */
  deletedAt?: string | null
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
  communicationPreferences: CommunicationPreferences
  savingsExperience: string
  walkthroughCompleted: boolean
  setupGuideSnoozedUntil: string | null
  setupGuideDismissed: boolean
  setupGuideShowOnDashboard: boolean
}

export function compareTransactionsDesc(a: Transaction, b: Transaction): number {
  const dateCmp = b.date.localeCompare(a.date)
  if (dateCmp !== 0) return dateCmp

  const aCreated = a.createdAt ?? a.updatedAt ?? ""
  const bCreated = b.createdAt ?? b.updatedAt ?? ""
  const createdCmp = bCreated.localeCompare(aCreated)
  if (createdCmp !== 0) return createdCmp

  return b.id.localeCompare(a.id)
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
    communicationPreferences: {
      featureUpdates: true,
      feedbackRequests: true,
      recurringReminders: true,
      renewalReminders: true,
      importAlerts: true,
    },
    savingsExperience: "engaged",
    walkthroughCompleted: false,
    setupGuideSnoozedUntil: null,
    setupGuideDismissed: false,
    setupGuideShowOnDashboard: true,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** True for temporary client ids from {@link generateId} (not server cuid). */
export function isClientOptimisticId(id: string): boolean {
  return /^\d+-[a-z0-9]+$/.test(id)
}

/** After a full server txn sync, keep in-flight optimistic rows not yet on the server. */
export function transactionsAfterFullServerSync<T extends { id: string }>(
  transactions: T[],
  serverIds: ReadonlySet<string>,
): T[] {
  return transactions.filter((t) => serverIds.has(t.id) || isClientOptimisticId(t.id))
}

/**
 * Apply a successful create: replace the optimistic row, or append if sync already
 * dropped it. Removes duplicate server-id rows when refresh merged the txn first.
 */
export function applyServerTransactionAfterOptimisticCreate<T extends { id: string }>(
  transactions: readonly T[],
  optimisticId: string,
  serverRow: T,
): T[] {
  const idx = transactions.findIndex((t) => t.id === optimisticId)
  if (idx >= 0) {
    const next = transactions.filter(
      (t) => t.id !== optimisticId && t.id !== serverRow.id,
    )
    const insertAt = Math.min(idx, next.length)
    return [...next.slice(0, insertAt), serverRow, ...next.slice(insertAt)]
  }
  if (transactions.some((t) => t.id === serverRow.id)) {
    return [...transactions]
  }
  return [serverRow, ...transactions]
}

export function getMonthKey(date: string): string {
  return transactionCalendarDay(date).slice(0, 7)
}

export function getCurrentMonthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

/**
 * Genesis floor for an envelope balance: one calendar day before the UTC creation date.
 *
 * Subtracting one day handles western-hemisphere users who create envelopes in the
 * evening — their local date is one day behind UTC, so a UTC date of "2026-06-01"
 * resolves to a floor of "2026-05-31", ensuring same-day transactions are always
 * included regardless of timezone.  The one-day margin means at most one extra
 * pre-genesis day could count, which is inconsequential compared to years of
 * historical CSV data being excluded.
 */
export function envelopeGenesisFloor(createdAtIso: string): string {
  const d = new Date(createdAtIso)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function getTransactionsForEnvelope(
  transactions: readonly Transaction[],
  envelopeId: string,
  monthKey?: string,
  genesisDateIso?: string,
): Transaction[] {
  return transactions.filter(
    t =>
      t.envelopeId === envelopeId &&
      (monthKey ? getMonthKey(t.date) === monthKey : true) &&
      (genesisDateIso ? t.date >= genesisDateIso : true),
  )
}

export function getEnvelopeBalance(
  transactions: readonly Transaction[],
  envelopeId: string,
  monthKey: string,
  genesisDateIso?: string,
): number {
  const monthTxns = getTransactionsForEnvelope(transactions, envelopeId, monthKey, genesisDateIso)
  const expenses = monthTxns.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)
  const credits = monthTxns.filter(t => t.type === "credit").reduce((sum, t) => sum + t.amount, 0)
  return credits - expenses
}

/**
 * All-time envelope balance (Savings hub total; not month-scoped).
 * Pass `genesisDateIso` (from `envelopeGenesisFloor(envelope.createdAt)`) to
 * exclude transactions that pre-date envelope creation — prevents historical CSV
 * imports from driving new envelopes deeply negative.
 */
export function getEnvelopeBalanceAllTime(
  transactions: readonly Transaction[],
  envelopeId: string,
  genesisDateIso?: string,
): number {
  const txns = getTransactionsForEnvelope(transactions, envelopeId, undefined, genesisDateIso)
  const expenses = txns.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)
  const credits = txns.filter(t => t.type === "credit").reduce((sum, t) => sum + t.amount, 0)
  return credits - expenses
}

/** Exclude ledger funding allocation legs from global-style feeds (dashboard recent, transactions page). */
export function transactionsVisibleInMainHistory(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((t) => !t.excludeFromMainHistory)
}

/**
 * Transaction list feed: global history hides funding legs; envelope-scoped views include them
 * so envelope balances tie back to visible Income rows on Savings.
 */
export function transactionsForTransactionList(
  transactions: readonly Transaction[],
  envelopeIds?: ReadonlySet<string>,
): Transaction[] {
  if (!envelopeIds || envelopeIds.size === 0) {
    return transactionsVisibleInMainHistory(transactions)
  }
  return transactions.filter((t) => {
    if (!envelopeIds.has(t.envelopeId)) return false
    if (!t.excludeFromMainHistory) return true
    return t.source === "envelope_funding_in" || t.source === "envelope_funding_out"
  })
}
