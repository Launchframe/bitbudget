// UI glue for the Financial Runway feature (B3).
//
// Pure helpers only — no React, no Prisma, no network. They turn a persisted
// plan (as returned by GET /api/runway/plan) plus resolved holdings into the
// numbers the Runway page and dashboard card render, and build the plain-English
// summary strings. Everything here is unit-testable.

import {
  computeRunwayNeed,
  type PlannedLine,
  type RunwayNeedResult,
  type RunwayScenario,
  type ScenarioMode,
} from "@/lib/runway-need"
import {
  computeRunwayGap,
  type RunwayGapResult,
  type RunwayGapScenarioInput,
} from "@/lib/runway-gap"
import {
  recommendBorrowCapFraction,
  resolveRiskAnswers,
  type BorrowStance,
  type BtcSharePreference,
  type DipResponse,
  type RiskAnswers,
} from "@/lib/runway-risk"
import { formatUsd } from "@/lib/data"

const SATS_PER_BTC = 1e8
const DAYS_PER_MONTH = 365.25 / 12

/** JSON shape returned by GET /api/runway/plan (Decimals already numberified). */
export interface RunwayPlanResponse {
  phase: "buildup" | "runway"
  quitDate: string | null
  horizonMonths: number
  runwayIncomeUsd: number
  livingBaselineOverrideUsd: number | null
  inflationRateYear: number
  stressPercent: number
  growthRateYear: number | null
  dipResponse: DipResponse
  btcSharePreference: BtcSharePreference
  borrowStance: BorrowStance
  editedCashFloorUsd: number | null
  editedBorrowCapFraction: number | null
  cashOverrideUsd: number | null
  bitcoinOverrideSats: number | null
  plannedLines: PlannedLine[]
  scenarios: RunwayScenario[]
  envelopePriorities: Record<string, "essential" | "flexible">
  checkupOpenedMonthKey: string | null
  createdAt: string
  updatedAt: string
}

/** Risk answers pulled off a plan. */
export function planRiskAnswers(plan: RunwayPlanResponse): RiskAnswers {
  return resolveRiskAnswers({
    dipResponse: plan.dipResponse,
    btcSharePreference: plan.btcSharePreference,
    borrowStance: plan.borrowStance,
  })
}

/**
 * Whether the user has actually set up their runway, versus landing on a fresh
 * default row the API auto-creates. Completing setup always records the phase
 * ("runway") or a quit date (earning), plus a living-cost figure, so any of
 * those diverging from defaults marks the plan configured.
 */
export function isRunwayConfigured(plan: RunwayPlanResponse | null): boolean {
  if (!plan) return false
  return (
    plan.phase === "runway" ||
    plan.quitDate != null ||
    plan.livingBaselineOverrideUsd != null ||
    plan.runwayIncomeUsd > 0 ||
    plan.plannedLines.length > 0
  )
}

/** Whole months from `todayIso` until `quitDate` (never negative). */
export function monthsUntilQuit(
  quitDate: string | null,
  todayIso: string,
): number {
  if (!quitDate) return 0
  const quit = Date.parse(`${quitDate}T00:00:00.000Z`)
  const today = Date.parse(`${todayIso}T00:00:00.000Z`)
  if (!Number.isFinite(quit) || !Number.isFinite(today)) return 0
  const days = (quit - today) / (24 * 60 * 60 * 1000)
  if (days <= 0) return 0
  return Math.round(days / DAYS_PER_MONTH)
}

/**
 * Living costs to feed the need math: an explicit override wins; otherwise fall
 * back to the recent-spend insight; otherwise 0. Negative/NaN inputs are
 * treated as unset.
 */
export function resolveLivingBaselineUsd(
  plan: RunwayPlanResponse,
  insightMonthlyUsd: number | null | undefined,
): number {
  if (plan.livingBaselineOverrideUsd != null && plan.livingBaselineOverrideUsd >= 0) {
    return plan.livingBaselineOverrideUsd
  }
  if (
    insightMonthlyUsd != null &&
    Number.isFinite(insightMonthlyUsd) &&
    insightMonthlyUsd > 0
  ) {
    return Math.round(insightMonthlyUsd * 100) / 100
  }
  return 0
}

/** Cash the user "knows" they have: the typed override replaces the computed total. */
export function knownCashUsd(
  savingsUsd: number,
  discretionaryUsd: number,
  override: number | null,
): number {
  if (override != null && override >= 0) return override
  return Math.max(0, savingsUsd) + Math.max(0, discretionaryUsd)
}

/** Spendable sats the user "knows" they have: the typed override replaces the wallet total. */
export function knownBitcoinSats(
  walletSats: number,
  override: number | null,
): number {
  if (override != null && override >= 0) return Math.round(override)
  return Math.max(0, Math.round(walletSats))
}

/** Effective borrow cap: an explicit edit wins, else the risk-derived recommendation. */
export function effectiveBorrowCapFraction(plan: RunwayPlanResponse): number {
  if (plan.editedBorrowCapFraction != null && plan.editedBorrowCapFraction >= 0) {
    return plan.editedBorrowCapFraction
  }
  return recommendBorrowCapFraction(planRiskAnswers(plan))
}

/** Whether the borrow block should appear (borrowing is allowed at all). */
export function borrowingAllowed(plan: RunwayPlanResponse): boolean {
  return effectiveBorrowCapFraction(plan) > 0
}

/** Full month name for a `YYYY-MM` key, e.g. "2026-03" → "March". */
export function checkupMonthName(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!m) return monthKey
  const month = Number(m[2])
  if (month < 1 || month > 12) return monthKey
  const d = new Date(Date.UTC(Number(m[1]), month - 1, 1))
  return d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })
}

/**
 * A monthly checkup is "ready" to prompt when the plan is set up and the user
 * has not yet opened this calendar month's checkup.
 */
export function isCheckupReady(
  plan: RunwayPlanResponse | null,
  currentMonthKey: string,
): boolean {
  if (!isRunwayConfigured(plan)) return false
  return plan!.checkupOpenedMonthKey !== currentMonthKey
}

/** Format a 0..1 share as a whole-percent string. */
export function formatSharePct(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—"
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`
}

/**
 * Format the liquidation-room percent for display. Unlike `formatSharePct`, a
 * negative value is NOT clamped to 0% — the price can be *below* the lender's
 * sell price, and hiding that breach as "0%" would misrepresent a loan that is
 * already liquidatable. Caps the upside at 100% but shows negatives (breach)
 * verbatim. `null`/non-finite → "—".
 */
export function formatLiquidationRoomPct(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—"
  return `${Math.round(Math.min(1, fraction) * 100)}%`
}

/** Convert integer sats to a USD value at a spot price (0 when price unknown). */
export function satsToUsd(sats: number, btcPriceUsd: number): number {
  if (!Number.isFinite(sats) || btcPriceUsd <= 0) return 0
  return (sats / SATS_PER_BTC) * btcPriceUsd
}

/**
 * One-line, plain-language gap summary for the dashboard card and page header.
 * Separates the cash shortfall from the bitcoin shortfall so a bold bitcoin
 * target never hides a short cash floor.
 */
export function gapSummaryLine(
  cashGapUsd: number,
  bitcoinGapUsd: number,
): string {
  const cashShort = Number.isFinite(cashGapUsd) && cashGapUsd > 0.5
  const btcShort = !Number.isFinite(bitcoinGapUsd) || bitcoinGapUsd > 0.5

  if (!cashShort && !btcShort) {
    return "You're on track for the runway you planned."
  }
  const parts: string[] = []
  if (cashShort) parts.push(`${formatUsd(cashGapUsd)} more in cash`)
  if (btcShort) {
    parts.push(
      Number.isFinite(bitcoinGapUsd)
        ? `${formatUsd(bitcoinGapUsd)} more in bitcoin`
        : "more bitcoin",
    )
  }
  return `Still need ${parts.join(" and ")} to reach your runway.`
}

/**
 * Build a PUT /api/runway/plan body from the current plan plus a patch. The PUT
 * replaces the whole row, so unspecified fields must be echoed back to avoid
 * resetting them to defaults. Server-managed timestamps are dropped.
 */
export function buildPlanPutBody(
  plan: RunwayPlanResponse,
  patch: Partial<RunwayPlanResponse>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...plan, ...patch }
  delete merged.createdAt
  delete merged.updatedAt
  return merged
}

export interface RunwayComputationInput {
  plan: RunwayPlanResponse
  /** Resolved monthly living costs (see resolveLivingBaselineUsd). */
  livingBaselineUsd: number
  /** Envelope cash known today (savings + discretionary remaining). */
  envelopeCashUsd: number
  /** Spendable bitcoin known today, in integer sats. */
  walletSats: number
  /** Sats a lender holds across open loans (collateral). */
  lenderHeldSats: number
  /** Total amount due today across open loans, in USD. */
  amountDueUsd: number
  /** Spot bitcoin price in USD. */
  btcPriceUsd: number
  /** Today's calendar day, `YYYY-MM-DD`. */
  todayIso: string
  /** Which scenarios to apply to the headline need: "none" | "enabled" | ids. */
  scenarioMode: ScenarioMode
  /** Flat monthly net savings into the stack during buildup. */
  monthlySavingsUsd: number
  /** Extra dollars/month if flexible envelopes return to usual spending. */
  flexibleCutMonthlyUsd: number
  /** Sats in transit from open bitcoin sales (placeholder so value doesn't vanish). */
  bitcoinOnTheWaySats?: number
  /** Cash in transit from open bitcoin sales (proceeds known, not yet linked). */
  cashOnTheWayUsd?: number
  /** Sats reserved by open sales (`sent` + `cash_on_the_way`); see RunwayHoldingsInput. */
  reservedForSaleSats?: number
}

export interface RunwayComputation {
  need: RunwayNeedResult
  gap: RunwayGapResult
  monthsUntilQuit: number
}

/** Compose the need + gap math for the Runway page and card from one input. */
export function buildRunwayComputation(
  input: RunwayComputationInput,
): RunwayComputation {
  const { plan } = input
  const riskAnswers = planRiskAnswers(plan)

  const need = computeRunwayNeed({
    livingBaselineUsd: input.livingBaselineUsd,
    plannedLines: plan.plannedLines,
    scenarios: plan.scenarios,
    runwayIncomeUsd: plan.runwayIncomeUsd,
    horizonMonths: plan.horizonMonths,
    inflationRateYear: plan.inflationRateYear,
    stressPercent: plan.stressPercent,
    growthRateYear: plan.growthRateYear,
    riskAnswers,
    editedCashFloorUsd: plan.editedCashFloorUsd,
    editedBorrowCapFraction: plan.editedBorrowCapFraction,
    holdings: {
      envelopeCashUsd: input.envelopeCashUsd,
      walletSats: input.walletSats,
      cashOverrideUsd: plan.cashOverrideUsd,
      bitcoinOverrideSats: plan.bitcoinOverrideSats,
      lenderHeldSats: input.lenderHeldSats,
      amountDueUsd: input.amountDueUsd,
      bitcoinOnTheWaySats: input.bitcoinOnTheWaySats,
      cashOnTheWayUsd: input.cashOnTheWayUsd,
      reservedForSaleSats: input.reservedForSaleSats,
    },
    btcPriceUsd: input.btcPriceUsd,
    scenarioMode: input.scenarioMode,
  })

  const gapScenarios: RunwayGapScenarioInput[] = plan.scenarios.map((s) => ({
    id: s.id,
    label: s.label,
    monthlyDeltaUsd: s.monthlyDeltaUsd,
    oneTimeUsd: s.oneTimeUsd,
  }))

  const gap = computeRunwayGap({
    monthsUntilQuit: monthsUntilQuit(plan.quitDate, input.todayIso),
    monthlySavingsUsd: input.monthlySavingsUsd,
    flexibleCutMonthlyUsd: input.flexibleCutMonthlyUsd,
    btcPriceUsd: input.btcPriceUsd,
    cashUsd: need.cashUsd,
    spendableSats: need.spendableSats,
    cashRequiredUsd: need.cashFloorUsedUsd,
    requiredBitcoinSats: need.requiredBitcoinSatsSpot,
    scenarios: gapScenarios,
  })

  return { need, gap, monthsUntilQuit: gap.monthsUntilQuit }
}
