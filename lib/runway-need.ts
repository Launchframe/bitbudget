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
/** Micro-dollars. Exact for cent prices inside the safe-integer range. */
const USD_MICROS = 1_000_000
/** Days per year used for annualizing historical CAGR windows. */
const DAYS_PER_YEAR = 365.25
const YEAR_MS = DAYS_PER_YEAR * 24 * 60 * 60 * 1000

function finiteNumber(n: number | null | undefined, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback
}

/** Sats are a non-negative count. Non-finite or negative input is zero. */
function nonNegativeSats(n: number | null | undefined, fallback = 0): number {
  const v = finiteNumber(n, fallback)
  if (v <= 0) return 0
  return Math.round(v)
}

/**
 * Sats required to cover `usd` at `priceUsd`, rounded up.
 *
 * `(usd / price) * 1e8` is often one ulp above an integer, so `Math.ceil`
 * charges an extra sat (`$134` at `$100` → 134000001). Scale both sides to
 * micro-dollars and ceil-divide in integers instead. A non-positive or
 * non-finite price cannot fund a positive dollar need (`Infinity`).
 */
function requiredSatsForUsd(usd: number, priceUsd: number): number {
  if (!(usd > 0)) return 0
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return Infinity
  const usdMicros = Math.round(usd * USD_MICROS)
  const priceMicros = Math.round(priceUsd * USD_MICROS)
  if (
    !Number.isSafeInteger(usdMicros) ||
    !Number.isSafeInteger(priceMicros) ||
    priceMicros <= 0
  ) {
    const raw = (usd * SATS_PER_BTC) / priceUsd
    if (!Number.isFinite(raw) || raw <= 0) return Infinity
    const nearest = Math.round(raw)
    if (Math.abs(raw - nearest) <= 1e-6) return nearest
    return Math.ceil(raw)
  }
  const sats = (BigInt(usdMicros) * BigInt(SATS_PER_BTC) + BigInt(priceMicros) - 1n) /
    BigInt(priceMicros)
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) return Infinity
  return Number(sats)
}

/** Bitcoin mark in dollars. A non-positive price marks the coins at zero, not below. */
function btcValueUsd(sats: number, priceUsd: number): number {
  if (!(sats > 0) || !Number.isFinite(priceUsd) || priceUsd <= 0) return 0
  return (sats / SATS_PER_BTC) * priceUsd
}

/**
 * Bitcoin's share of gross assets (cash + bitcoin, before liabilities).
 * Cash that is underwater by at least the bitcoin mark is still a 100% bitcoin
 * position — reporting 0 there would skip the over-allocation cash cushion.
 */
function bitcoinShare(btcUsd: number, cashUsd: number): number {
  const btc = Number.isFinite(btcUsd) && btcUsd > 0 ? btcUsd : 0
  const cash = Number.isFinite(cashUsd) ? cashUsd : 0
  if (btc === 0) return 0
  const gross = cash + btc
  if (!(gross > 0)) return 1
  return btc / gross
}

/**
 * `(1 + rate) ^ years`. A base below 0 is not a usable nominal factor
 * (fractional powers are NaN). A base of exactly 0 is defined.
 */
function compoundFactor(rate: number, years: number): number {
  if (!Number.isFinite(rate) || !Number.isFinite(years)) return Number.NaN
  const base = 1 + rate
  if (base < 0) return Number.NaN
  const factor = Math.pow(base, years)
  return Number.isFinite(factor) ? factor : Number.NaN
}

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
  // A stray string is iterable, and `new Set("ab")` would match ids "a" and "b".
  if (!Array.isArray(mode)) return []
  const ids = new Set(mode)
  return scenarios.filter((s) => ids.has(s.id))
}

export function computeRunwayNeed(input: RunwayNeedInput): RunwayNeedResult {
  const active = activeScenarios(input.scenarios, input.scenarioMode)
  const scenarioMonthlyDeltaUsd = active.reduce(
    (s, sc) => s + finiteNumber(sc.monthlyDeltaUsd),
    0,
  )
  const oneTimeNetUsd = active.reduce((s, sc) => s + finiteNumber(sc.oneTimeUsd), 0)

  // 1–2. Living after replacements.
  //   - Every planned line adds its monthly cost.
  //   - A "replaces" line additionally removes the old recurring cost it
  //     stands in for; the replaced aggregate floors living at 0 (not negative).
  //   - Active scenario monthly deltas adjust living (can be negative).
  // Non-finite amounts are ignored so one bad line cannot NaN the plan.
  const plannedMonthlyTotal = input.plannedLines.reduce(
    (s, l) => s + finiteNumber(l.monthlyUsd),
    0,
  )
  const replacedTotal = input.plannedLines.reduce(
    (s, l) => (l.mode === "replaces" ? s + finiteNumber(l.replacesMonthlyUsd) : s),
    0,
  )
  const livingBaselineUsd = finiteNumber(input.livingBaselineUsd)
  const livingAfterReplace = Math.max(0, livingBaselineUsd - replacedTotal)
  const livingEffectiveUsd = Math.max(
    0,
    livingAfterReplace + plannedMonthlyTotal + scenarioMonthlyDeltaUsd,
  )

  // 3. Monthly draw = living the user must cover out of their own stack.
  const monthlyDrawUsd = Math.max(0, livingEffectiveUsd - finiteNumber(input.runwayIncomeUsd))

  // 4. Resolve holdings (overrides replace one side only).
  // Cash may be negative (an overspent envelope). Sats and amount due may not.
  const cashUsd = finiteNumber(input.holdings.cashOverrideUsd ?? input.holdings.envelopeCashUsd)
  const spendableSats = nonNegativeSats(
    input.holdings.bitcoinOverrideSats ?? input.holdings.walletSats,
  )
  const lenderHeldSats = nonNegativeSats(input.holdings.lenderHeldSats)
  const amountDueUsd = Math.max(0, finiteNumber(input.holdings.amountDueUsd))
  const bitcoinOnTheWaySats = nonNegativeSats(input.holdings.bitcoinOnTheWaySats)
  const cashOnTheWayUsd = finiteNumber(input.holdings.cashOnTheWayUsd)

  // Everything marked as bitcoin for stack + exposure purposes: spendable,
  // lender-held (still the user's exposure), and bitcoin on the way.
  const btcMarkSats = spendableSats + lenderHeldSats + bitcoinOnTheWaySats
  const btcMarkUsd = btcValueUsd(btcMarkSats, input.btcPriceUsd)

  // 5. Stack mark at spot = cash + cash on the way + all bitcoin value − amount due.
  const stackUsd = cashUsd + cashOnTheWayUsd + btcMarkUsd - amountDueUsd

  // 7. Actual bitcoin share = all bitcoin mark / gross assets (assets before the liability).
  const actualBtcShare = bitcoinShare(btcMarkUsd, cashUsd + cashOnTheWayUsd)

  // 6. Risk profile → cash floor + borrow cap.
  const profile = resolveRiskProfile(input.riskAnswers)
  const cashFloorMonths = recommendCashFloorMonths(
    profile.answers,
    actualBtcShare,
    profile.targetBtcShare,
  )
  const recommendedFloorUsd = recommendedCashFloorUsd(cashFloorMonths, monthlyDrawUsd)
  // A negative edited floor would count as extra spendable cash. Non-finite
  // edits fall back to the recommendation. A cap above 1 is left alone.
  const editedFloor = input.editedCashFloorUsd
  const cashFloorUsedUsd =
    editedFloor == null || !Number.isFinite(editedFloor)
      ? recommendedFloorUsd
      : Math.max(0, editedFloor)
  const editedCap = input.editedBorrowCapFraction
  const borrowCapFraction =
    editedCap == null || !Number.isFinite(editedCap)
      ? recommendBorrowCapFraction(profile.answers)
      : Math.max(0, editedCap)

  // 11. Stress price. Below zero (a drop past 100%) is kept on the result so
  // callers can see it, but marks treat that price as worthless rather than
  // a negative asset.
  const stressPriceUsd = finiteNumber(input.btcPriceUsd) * (1 - finiteNumber(input.stressPercent))
  const btcMarkStressUsd = btcValueUsd(btcMarkSats, stressPriceUsd)
  const stackAtStressUsd = cashUsd + cashOnTheWayUsd + btcMarkStressUsd - amountDueUsd

  // 8. Required cash at horizon: preserve the floor's purchasing power.
  // A rate that cannot be compounded (non-finite, or below -100%) leaves the
  // floor unchanged instead of emitting NaN. Exactly -100% still goes to zero.
  const horizonMonths = Number.isFinite(input.horizonMonths) ? Math.max(0, input.horizonMonths) : 0
  const horizonYears = horizonMonths / 12
  const inflationFactor = compoundFactor(input.inflationRateYear, horizonYears)
  const requiredCashAtHorizonUsd =
    cashFloorUsedUsd * (Number.isFinite(inflationFactor) ? inflationFactor : 1)

  // 9. Draw over horizon, reduced by net one-time proceeds from scenarios.
  const drawOverHorizonUsd = monthlyDrawUsd * horizonMonths
  const requiredSpendableUsd = Math.max(0, drawOverHorizonUsd - oneTimeNetUsd)

  // 10 & 12. Required bitcoin sats to fund the draw at a given price.
  // A non-positive or non-finite price means bitcoin cannot fund any dollar
  // draw: return Infinity rather than 0, which would imply no bitcoin is
  // needed. When nothing must be funded, 0 sats is correct at any price.
  const requiredSatsAt = (price: number): number => requiredSatsForUsd(requiredSpendableUsd, price)
  const requiredBitcoinSatsSpot = requiredSatsAt(input.btcPriceUsd)
  const requiredBitcoinSatsStress = requiredSatsAt(stressPriceUsd)

  // 12. Growth reading: if bitcoin is expected to grow, fewer sats are needed to
  // fund the same dollar draw. This does NOT change the cash floor or the
  // flat/stress required stack — it only lowers the sats requirement.
  // `null` growth is flat. A rate below -100% (or otherwise non-compoundable)
  // is not a price path: the growth reading treats bitcoin as unable to fund
  // the draw instead of returning NaN.
  const growthRate = input.growthRateYear ?? 0
  const growthFactor = compoundFactor(growthRate, horizonYears)
  const growthPrice = Number.isFinite(growthFactor) ? input.btcPriceUsd * growthFactor : 0
  const requiredBitcoinSatsGrowth = requiredSatsAt(growthPrice)

  // Total required stack mark ≈ required cash (floor) + required spendable (draw).
  const requiredStackSpotUsd = requiredCashAtHorizonUsd + requiredSpendableUsd
  const requiredStackStressUsd = requiredStackSpotUsd

  // 13. Months left: spend cash above the floor first, then spendable bitcoin.
  // Unencumbered bitcoin = spendable only (not lender-held, not on the way).
  const cashAboveFloorUsd = Math.max(0, cashUsd + cashOnTheWayUsd - cashFloorUsedUsd)
  const monthsLeftFromPrice = (price: number): number | null => {
    if (!(monthlyDrawUsd > 0)) return null
    return (cashAboveFloorUsd + btcValueUsd(spendableSats, price)) / monthlyDrawUsd
  }
  const monthsLeft = monthsLeftFromPrice(input.btcPriceUsd)
  const monthsLeftAtStress = monthsLeftFromPrice(stressPriceUsd)
  const monthsLeftAtGrowth = monthsLeftFromPrice(growthPrice)
  const borrowCapacityUsd = borrowCapFraction * btcValueUsd(spendableSats, input.btcPriceUsd)

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
 * starting price is non-positive, or when the ending price is negative.
 * A zero ending price is a −100% CAGR. `full` always uses the earliest and
 * latest points. Non-finite prices and unparseable dates are dropped.
 */
export function historicalCagrs(
  prices: { date: string; priceUsd: number }[],
): HistoricalCagrs {
  if (prices.length < 2) {
    return { years4: null, years8: null, full: null }
  }
  const sorted = [...prices]
    .map((p) => ({ ms: Date.parse(p.date), priceUsd: p.priceUsd }))
    .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.priceUsd))
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
    if (years <= 0 || !(start.priceUsd > 0) || end.priceUsd < 0) return null
    const rate = Math.pow(end.priceUsd / start.priceUsd, 1 / years) - 1
    return Number.isFinite(rate) ? rate : null
  }

  return {
    years4: cagrForWindow(4),
    years8: cagrForWindow(8),
    full: cagrForWindow(null),
  }
}
