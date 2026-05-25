import {
  TX_SOURCE_ENVELOPE_SWEEP,
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
} from "@/lib/constants"
import type { Envelope, Transaction } from "@/lib/data"
import { getEnvelopeBalanceAllTime, getMonthKey } from "@/lib/data"

export const SAVINGS_INFLOW_SOURCES = new Set([
  "paycheck",
  "irregular_income",
  "income_import",
  TX_SOURCE_ENVELOPE_SWEEP,
])

export function findSavingsEnvelope(envelopes: readonly Envelope[]): Envelope | undefined {
  return envelopes.find((e) => !e.archived && e.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS)
}

export function savingsBalance(
  transactions: readonly Transaction[],
  savingsEnvelope: Envelope | undefined,
): number {
  if (!savingsEnvelope) return 0
  return getEnvelopeBalanceAllTime(transactions as Transaction[], savingsEnvelope.id)
}

export function sumRemainingDiscretionary(
  transactions: readonly Transaction[],
  discretionaryEnvelopes: readonly Envelope[],
): number {
  return discretionaryEnvelopes.reduce(
    (sum, env) => sum + getEnvelopeBalanceAllTime(transactions as Transaction[], env.id),
    0,
  )
}

export function isSavingsInflowCredit(txn: Transaction, savingsEnvelopeId: string): boolean {
  if (txn.envelopeId !== savingsEnvelopeId || txn.type !== "credit" || txn.excludeFromMainHistory) {
    return false
  }
  const src = txn.source ?? "manual"
  return SAVINGS_INFLOW_SOURCES.has(src)
}

export function sumEnvelopeSweepCreditsYear(
  transactions: readonly Transaction[],
  savingsEnvelopeId: string,
  year: string,
): number {
  return transactions
    .filter(
      (t) =>
        t.envelopeId === savingsEnvelopeId &&
        t.type === "credit" &&
        t.source === TX_SOURCE_ENVELOPE_SWEEP &&
        t.date.startsWith(year),
    )
    .reduce((sum, t) => sum + t.amount, 0)
}

export function avgMonthlySpendLastNMonths(
  transactions: readonly Transaction[],
  discretionaryEnvelopeIds: ReadonlySet<string>,
  months: number,
): number {
  const now = new Date()
  const monthKeys = new Set<string>()
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    monthKeys.add(getMonthKey(d.toISOString().split("T")[0]!))
  }

  const byMonth = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== "expense" || t.excludeFromMainHistory) continue
    if (!discretionaryEnvelopeIds.has(t.envelopeId)) continue
    const mk = getMonthKey(t.date)
    if (!monthKeys.has(mk)) continue
    byMonth.set(mk, (byMonth.get(mk) ?? 0) + t.amount)
  }

  if (byMonth.size === 0) return 0
  return Array.from(byMonth.values()).reduce((a, b) => a + b, 0) / byMonth.size
}

export function daysOfIndependence(savingsBal: number, avgMonthlySpend: number): number {
  if (avgMonthlySpend <= 0 || savingsBal <= 0) return 0
  return Math.floor(savingsBal / (avgMonthlySpend / 30))
}

export interface SavingsGoalRow {
  periodKey: string
  targetAmount: number
  startBalance?: number | null
  actualSavedAmount?: number | null
  achievedGoal?: boolean | null
  progressPct?: number | null
  closedAt?: string | null
  graceEndsAt?: string | null
  editability?: "editable" | "upward_only" | "closed"
}

export function computeGoalStreak(closedGoals: SavingsGoalRow[]): number {
  const sorted = [...closedGoals]
    .filter((g) => g.closedAt)
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
  let streak = 0
  for (const row of sorted) {
    if (row.achievedGoal) streak++
    else break
  }
  return streak
}

export function bestMonthFromGoals(closedGoals: SavingsGoalRow[]): { amount: number; periodKey: string } | null {
  let best: { amount: number; periodKey: string } | null = null
  for (const row of closedGoals) {
    const amt = row.actualSavedAmount ?? 0
    if (amt <= 0) continue
    if (!best || amt > best.amount) best = { amount: amt, periodKey: row.periodKey }
  }
  return best
}

export function formatPeriodKeyLabel(periodKey: string): string {
  if (periodKey === "default") return "Default"
  const [y, m] = periodKey.split("-")
  if (!y || !m) return periodKey
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

export const ACHIEVEMENT_LABELS: Record<string, string> = {
  first_dollar: "First dollar",
  first_hundred: "$100 saved",
  first_thousand: "$1K saved",
  first_ten_thousand: "$10K saved",
  first_hundred_thousand: "$100K saved",
  goal_hit: "Goal hit",
  streak_3: "3-month streak",
  streak_6: "6-month streak",
  streak_12: "12-month streak",
  over_saver: "Over-saver",
  swept_first: "First sweep",
  swept_clean_month: "Clean sweep",
  irregular_income_first: "Extra income",
  import_complete: "Income imported",
  year_one: "One year",
}

const GOAL_RING_GRAY = "#737373"
const GOAL_RING_RED = "#EF4444"
const GOAL_RING_YELLOW = "#EAB308"
const GOAL_RING_GREEN = "#22C55E"

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0"))
    .join("")}`
}

function lerpHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  const u = Math.min(1, Math.max(0, t))
  return rgbToHex(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u)
}

/** 0% gray; 1–100% smooth red → yellow → green (monthly savings goal ring). */
export function goalProgressRingColor(progress: number): string {
  const pct = Math.min(1, Math.max(0, progress))
  if (pct <= 0) return GOAL_RING_GRAY
  if (pct < 0.5) return lerpHex(GOAL_RING_RED, GOAL_RING_YELLOW, pct * 2)
  return lerpHex(GOAL_RING_YELLOW, GOAL_RING_GREEN, (pct - 0.5) * 2)
}
