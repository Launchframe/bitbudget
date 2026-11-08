// Pure math for "Runway need": given a plan (living costs, planned lines,
// what-if scenarios), holdings (cash + bitcoin), a horizon, and a risk profile,
// work out how big a stack the user needs and how long the money lasts.
//
// No Prisma, no React, no wallet imports — arithmetic only, so the server and
// client can share it. All bitcoin amounts are integer sats; dollar amounts are
// plain numbers (USD).

import {
  recommendBorrowCapFraction,
  recommendCashFloorMonths,
  recommendedCashFloorUsd,
  resolveRiskProfile,
  type RiskAnswers,
} from "@/lib/runway-risk"

const SATS_PER_BTC = 1e8
/** Days per year used for annualizing historical CAGR windows. */
const DAYS_PER_YEAR = 365.25
const YEAR_MS = DAYS_PER_YEAR * 24 * 60 * 60 * 1000

export type PlannedLineGroup = "bitbudget" | "llc" | "agents" | "other"
export type PlannedLineMode = "add" | "replaces"

export interface PlannedLine {
  id: string
  group: PlannedLineGroup
  label: string
  monthlyUsd: number
  mode: PlannedLineMode
  /** When mode is replaces, the monthly average being replaced (subtracted from living). */
  replacesMonthlyUsd?: number
}

export interface RunwayScenario {
  id: string
  label: string
  monthlyDeltaUsd: number // negative when a bill shrinks
  oneTimeUsd: number // positive = proceeds; negative = one-time cost
  enabled: boolean
}

export interface RunwayHoldingsInput {
  envelopeCashUsd: number
  walletSats: number
  cashOverrideUsd?: number | null
  bitcoinOverrideSats?: number | null
  /** Open loans: lender holds these sats; amount due is a liability. */
  lenderHeldSats?: number
  amountDueUsd?: number
  /** Pending sale: bitcoin on the way (sats) OR cash on the way (usd) — summed across open sales. */
  bitcoinOnTheWaySats?: number
  cashOnTheWayUsd?: number
}

/** Which scenarios to apply for a single evaluation. */
export type ScenarioMode = "none" | "enabled" | string[]

export interface RunwayNeedInput {
  livingBaselineUsd: number
  plannedLines: PlannedLine[]
  scenarios: RunwayScenario[]
  runwayIncomeUsd: number
  horizonMonths: number
  inflationRateYear: number // e.g. 0.05
  stressPercent: number // e.g. 0.5 means a 50% drop
  growthRateYear: number | null // null/undefined = flat
  riskAnswers: RiskAnswers | null
  editedCashFloorUsd?: number | null
  editedBorrowCapFraction?: number | null
  holdings: RunwayHoldingsInput
  btcPriceUsd: number
  scenarioMode: ScenarioMode
}

export interface RunwayNeedResult {
  // Plan → monthly draw
  livingEffectiveUsd: number
  monthlyDrawUsd: number
  activeScenarioIds: string[]
  scenarioMonthlyDeltaUsd: number
  oneTimeNetUsd: number

  // Resolved holdings
  cashUsd: number
  cashOnTheWayUsd: number
  spendableSats: number
  lenderHeldSats: number
  bitcoinOnTheWaySats: number
  amountDueUsd: number
  btcMarkSats: number

  // Stack mark
  stackUsd: number
  stackAtStressUsd: number
  stressPriceUsd: number

  // Risk profile
  targetBtcShare: number
  actualBtcShare: number
  cashFloorMonths: number
  recommendedCashFloorUsd: number
  cashFloorUsedUsd: number
  borrowCapFraction: number
  borrowCapacityUsd: number

  // Horizon requirements
  requiredCashAtHorizonUsd: number
  drawOverHorizonUsd: number
  requiredSpendableUsd: number
  requiredBitcoinSatsSpot: number
  requiredBitcoinSatsStress: number
  requiredBitcoinSatsGrowth: number
  requiredStackSpotUsd: number
  requiredStackStressUsd: number

  // Months left
  monthsLeft: number | null
  monthsLeftAtStress: number | null
  monthsLeftAtGrowth: number | null
}

/** Labels offered in the planned-lines UI (A1 constant; wired up later). */
export const OFFERED_PLANNED_LINE_LABELS: readonly { group: PlannedLineGroup; label: string }[] = [
  { group: "bitbudget", label: "BitBudget ads" },
  { group: "bitbudget", label: "BitBudget hosting" },
  { group: "llc", label: "LLC travel" },
  { group: "llc", label: "LLC demos" },
  { group: "llc", label: "LLC merchandise" },
  { group: "llc", label: "LLC advertising" },
  { group: "agents", label: "Agent tokens" },
]

/** Resolve which scenarios are active for a given mode. */
export function activeScenarios(
  scenarios: readonly RunwayScenario[],
  mode: ScenarioMode,
): RunwayScenario[] {
  if (mode === "none") return []
  if (mode === "enabled") return scenarios.filter((s) => s.enabled)
  const ids = new Set(mode)
  return scenarios.filter((s) => ids.has(s.id))
}

export function computeRunwayNeed(input: RunwayNeedInput): RunwayNeedResult {
  const active = activeScenarios(input.scenarios, input.scenarioMode)
  const scenarioMonthlyDeltaUsd = active.reduce((s, sc) => s + sc.monthlyDeltaUsd, 0)
  const oneTimeNetUsd = active.reduce((s, sc) => s + sc.oneTimeUsd, 0)

  // 1–2. Living after replacements.
  //   - Every planned line adds its monthly cost.
  //   - A "replaces" line additionally removes the old recurring cost it
  //     stands in for; the replaced aggregate floors living at 0 (not negative).
  //   - Active scenario monthly deltas adjust living (can be negative).
  const plannedMonthlyTotal = input.plannedLines.reduce((s, l) => s + l.monthlyUsd, 0)
  const replacedTotal = input.plannedLines.reduce(
    (s, l) => (l.mode === "replaces" ? s + (l.replacesMonthlyUsd ?? 0) : s),
    0,
  )
  const livingAfterReplace = Math.max(0, input.livingBaselineUsd - replacedTotal)
  const livingEffectiveUsd = Math.max(
    0,
    livingAfterReplace + plannedMonthlyTotal + scenarioMonthlyDeltaUsd,
  )

  // 3. Monthly draw = living the user must cover out of their own stack.
  const monthlyDrawUsd = Math.max(0, livingEffectiveUsd - input.runwayIncomeUsd)

  // 4. Resolve holdings (overrides replace one side only).
  const cashUsd = input.holdings.cashOverrideUsd ?? input.holdings.envelopeCashUsd
  const spendableSats = input.holdings.bitcoinOverrideSats ?? input.holdings.walletSats
  const lenderHeldSats = input.holdings.lenderHeldSats ?? 0
  const amountDueUsd = input.holdings.amountDueUsd ?? 0
  const bitcoinOnTheWaySats = input.holdings.bitcoinOnTheWaySats ?? 0
  const cashOnTheWayUsd = input.holdings.cashOnTheWayUsd ?? 0

  // Everything marked as bitcoin for stack + exposure purposes: spendable,
  // lender-held (still the user's exposure), and bitcoin on the way.
  const btcMarkSats = spendableSats + lenderHeldSats + bitcoinOnTheWaySats
  const btcMarkUsd = (btcMarkSats / SATS_PER_BTC) * input.btcPriceUsd

  // 5. Stack mark at spot = cash + cash on the way + all bitcoin value − amount due.
  const stackUsd = cashUsd + cashOnTheWayUsd + btcMarkUsd - amountDueUsd

  // 7. Actual bitcoin share = all bitcoin mark / gross assets (assets before the liability).
  const grossAssetsUsd = cashUsd + cashOnTheWayUsd + btcMarkUsd
  const actualBtcShare = grossAssetsUsd > 0 ? btcMarkUsd / grossAssetsUsd : 0

  // 6. Risk profile → cash floor + borrow cap.
  const profile = resolveRiskProfile(input.riskAnswers)
  const cashFloorMonths = recommendCashFloorMonths(
    profile.answers,
    actualBtcShare,
    profile.targetBtcShare,
  )
  const recommendedFloorUsd = recommendedCashFloorUsd(cashFloorMonths, monthlyDrawUsd)
  const cashFloorUsedUsd = input.editedCashFloorUsd ?? recommendedFloorUsd
  const borrowCapFraction =
    input.editedBorrowCapFraction ?? recommendBorrowCapFraction(profile.answers)

  // 11. Stress price.
  const stressPriceUsd = input.btcPriceUsd * (1 - input.stressPercent)
  const btcMarkStressUsd = (btcMarkSats / SATS_PER_BTC) * stressPriceUsd
  const stackAtStressUsd = cashUsd + cashOnTheWayUsd + btcMarkStressUsd - amountDueUsd

  // 8. Required cash at horizon: preserve the floor's purchasing power.
  const horizonYears = input.horizonMonths / 12
  const requiredCashAtHorizonUsd =
    cashFloorUsedUsd * Math.pow(1 + input.inflationRateYear, horizonYears)

  // 9. Draw over horizon, reduced by net one-time proceeds from scenarios.
  const drawOverHorizonUsd = monthlyDrawUsd * input.horizonMonths
  const requiredSpendableUsd = Math.max(0, drawOverHorizonUsd - oneTimeNetUsd)

  // 10 & 12. Required bitcoin sats to fund the draw at a given price.
  const requiredSatsAt = (price: number): number => {
    if (price <= 0) return 0
    return Math.max(0, Math.ceil((requiredSpendableUsd / price) * SATS_PER_BTC))
  }
  const requiredBitcoinSatsSpot = requiredSatsAt(input.btcPriceUsd)
  const requiredBitcoinSatsStress = requiredSatsAt(stressPriceUsd)

  // 12. Growth reading: if bitcoin is expected to grow, fewer sats are needed to
  // fund the same dollar draw. This does NOT change the cash floor or the
  // flat/stress required stack — it only lowers the sats requirement.
  const growthRate = input.growthRateYear ?? 0
  const growthPrice = input.btcPriceUsd * Math.pow(1 + growthRate, horizonYears)
  const requiredBitcoinSatsGrowth = requiredSatsAt(growthPrice)

  // Total required stack mark ≈ required cash (floor) + required spendable (draw).
  const requiredStackSpotUsd = requiredCashAtHorizonUsd + requiredSpendableUsd
  const requiredStackStressUsd = requiredStackSpotUsd

  // 13. Months left: spend cash above the floor first, then spendable bitcoin.
  // Unencumbered bitcoin = spendable only (not lender-held, not on the way).
  const cashAboveFloorUsd = Math.max(0, cashUsd + cashOnTheWayUsd - cashFloorUsedUsd)
  const spendableBtcUsd = (spendableSats / SATS_PER_BTC) * input.btcPriceUsd
  const spendableBtcStressUsd = (spendableSats / SATS_PER_BTC) * stressPriceUsd
  const monthsLeftFrom = (spendableMarkUsd: number): number | null =>
    monthlyDrawUsd > 0 ? (cashAboveFloorUsd + spendableMarkUsd) / monthlyDrawUsd : null
  const monthsLeft = monthsLeftFrom(spendableBtcUsd)
  const monthsLeftAtStress = monthsLeftFrom(spendableBtcStressUsd)
  const spendableBtcGrowthUsd = (spendableSats / SATS_PER_BTC) * growthPrice
  const monthsLeftAtGrowth = monthsLeftFrom(spendableBtcGrowthUsd)
  const borrowCapacityUsd = borrowCapFraction * spendableBtcUsd

  return {
    livingEffectiveUsd,
    monthlyDrawUsd,
    activeScenarioIds: active.map((s) => s.id),
    scenarioMonthlyDeltaUsd,
    oneTimeNetUsd,

    cashUsd,
    cashOnTheWayUsd,
    spendableSats,
    lenderHeldSats,
    bitcoinOnTheWaySats,
    amountDueUsd,
    btcMarkSats,

    stackUsd,
    stackAtStressUsd,
    stressPriceUsd,

    targetBtcShare: profile.targetBtcShare,
    actualBtcShare,
    cashFloorMonths,
    recommendedCashFloorUsd: recommendedFloorUsd,
    cashFloorUsedUsd,
    borrowCapFraction,
    borrowCapacityUsd,

    requiredCashAtHorizonUsd,
    drawOverHorizonUsd,
    requiredSpendableUsd,
    requiredBitcoinSatsSpot,
    requiredBitcoinSatsStress,
    requiredBitcoinSatsGrowth,
    requiredStackSpotUsd,
    requiredStackStressUsd,

    monthsLeft,
    monthsLeftAtStress,
    monthsLeftAtGrowth,
  }
}

/** Evaluate the plan with a specific scenario mode (convenience wrapper). */
export function evaluateScenarioSet(
  input: RunwayNeedInput,
  mode: ScenarioMode,
): RunwayNeedResult {
  return computeRunwayNeed({ ...input, scenarioMode: mode })
}

export interface RunwayNeedVariants {
  none: RunwayNeedResult
  allEnabled: RunwayNeedResult
  eachEnabled: { id: string; label: string; result: RunwayNeedResult }[]
}

/** Compute the plan with no scenarios, every enabled scenario, and each enabled scenario alone. */
export function computeRunwayNeedVariants(input: RunwayNeedInput): RunwayNeedVariants {
  const enabled = input.scenarios.filter((s) => s.enabled)
  return {
    none: evaluateScenarioSet(input, "none"),
    allEnabled: evaluateScenarioSet(input, "enabled"),
    eachEnabled: enabled.map((s) => ({
      id: s.id,
      label: s.label,
      result: evaluateScenarioSet(input, [s.id]),
    })),
  }
}

export interface HistoricalCagrs {
  years4: number | null
  years8: number | null
  full: number | null
}

/**
 * Annualized CAGR over trailing windows.
 *
 * Prices are sorted ascending by date. For a trailing window of W years, the
 * window is [last − W years, last]; the CAGR is taken between the first price in
 * that window and the last price. A window is null when the data does not reach
 * back W full years, when there are fewer than two points, or when the span /
 * starting price is non-positive. `full` always uses the earliest and latest points.
 */
export function historicalCagrs(
  prices: { date: string; priceUsd: number }[],
): HistoricalCagrs {
  if (prices.length < 2) {
    return { years4: null, years8: null, full: null }
  }
  const sorted = [...prices]
    .map((p) => ({ ms: Date.parse(p.date), priceUsd: p.priceUsd }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms)
  if (sorted.length < 2) {
    return { years4: null, years8: null, full: null }
  }

  const end = sorted[sorted.length - 1]!

  const cagrForWindow = (windowYears: number | null): number | null => {
    let start = sorted[0]!
    if (windowYears != null) {
      const cutoffMs = end.ms - windowYears * YEAR_MS
      // Data must reach back to (or before) the window start.
      if (sorted[0]!.ms > cutoffMs) return null
      // First price within the window.
      start = sorted.find((p) => p.ms >= cutoffMs) ?? end
    }
    const years = (end.ms - start.ms) / YEAR_MS
    if (years <= 0 || start.priceUsd <= 0) return null
    return Math.pow(end.priceUsd / start.priceUsd, 1 / years) - 1
  }

  return {
    years4: cagrForWindow(4),
    years8: cagrForWindow(8),
    full: cagrForWindow(null),
  }
}
