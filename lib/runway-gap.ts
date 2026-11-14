// Pure math for "Runway gap (the quit-day gap)": project where cash and bitcoin
// land on the quit date and compare each side to what the runway plan requires.
//
// No Prisma, no React, no wallet imports — arithmetic only, so the server and
// client can share it. All bitcoin amounts are integer sats; dollar amounts are
// plain numbers (USD). Builds on `@/lib/runway-need` (A1): the caller feeds the
// resolved holdings and required floor / required bitcoin from a RunwayNeedResult.
//
// Projection model
// ----------------
// 1. Start from resolved holdings today (`cashUsd`, `spendableSats`).
// 2. Each month until quit, add `monthlySavingsUsd` (flat paycheck net into the
//    stack — buildup pay is flat, no raise). New savings fill the cash floor
//    first until projected cash >= `cashRequiredUsd`, then the remainder buys
//    bitcoin at `btcPriceUsd` (USD -> sats via SATS_PER_BTC, same convention as
//    runway-need; sats floored for a conservative projected balance).
// 3. The "return to usual" projection adds `flexibleCutMonthlyUsd` on top of
//    monthly savings (flexible envelopes stop feeding the stack). The caller
//    supplies that dollar figure (e.g. from an expense insight) as a number.
// 4. Scenarios: each what-if frees `-monthlyDeltaUsd` per month (a bill that
//    shrinks has a negative delta) plus a one-time `oneTimeUsd` (positive =
//    sale proceeds that reduce what you still need; negative = a one-time cost
//    that increases it). The scenario's extra dollars close the dollar gap
//    (cash) first, then the bitcoin gap — mirroring the floor-first allocation.
//
// Cash and bitcoin gaps stay separate everywhere so a high bitcoin target never
// hides a cash floor that is short.
//
// Infinity handling: when the required bitcoin side is +Infinity (A1 returns
// this under a 100% stress drop / non-positive price), the bitcoin gap stays
// Infinity in both sats and USD and never produces NaN. `monthsToCloseDollarGap`
// then also surfaces as Infinity. NaN, -Infinity, and negative requirements are
// not that sentinel — they count as no bitcoin requirement, so a bad input
// cannot look like a gap that never closes.
//
// Months that are not a finite number (NaN, Infinity) clamp to 0, same as a
// quit date already in the past. An infinite horizon would buy infinite sats
// and wipe a finite bitcoin gap.
//
// Sat conversion uses integer micro-dollars. `(usd / price) * 1e8` is often a
// hair under the real sat count, so a float floor drops one sat ($0.49 at
// $100k → 489 instead of 490) and leaves a phantom gap after the cash floor is
// already met. Buys floor (only sats fully paid for). Sales ceil, so a drain
// does not nick a cash floor that was already met by a fraction of a sat.
// A non-finite price buys and sells nothing; those dollars stay in cash.

const SATS_PER_BTC = 1e8
/** Micro-dollars. Exact for cent prices inside the safe-integer range. */
const USD_MICROS = 1_000_000

function finiteOrZero(n: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0
}

/** Past, NaN, and infinite horizons all project "no months left to save". */
function sanitizeMonths(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0
  return Math.max(0, n)
}

function sanitizeCashRequired(n: number): number {
  if (n === Infinity) return Infinity
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0
  return n
}

/** Holdings are a non-negative sat count. Negative and non-finite input is 0. */
function sanitizeHoldingsSats(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return 0
  const rounded = Math.round(n)
  if (!Number.isSafeInteger(rounded) || rounded <= 0) return 0
  return rounded
}

/**
 * Required sats. +Infinity is the A1 "bitcoin cannot fund this" sentinel.
 * Anything else that is not a positive safe integer is no requirement — a
 * negative target must not invent surplus that swallows a later cost.
 * A positive count that does not fit in a safe integer stays Infinity so the
 * gap cannot show as closed.
 */
function sanitizeRequiredSats(n: number): number {
  if (n === Infinity) return Infinity
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return 0
  const rounded = Math.round(n)
  if (!Number.isSafeInteger(rounded)) return Infinity
  return rounded
}

function priceIsUsable(priceUsd: number): boolean {
  return Number.isFinite(priceUsd) && priceUsd > 0
}

type SatRound = "floor" | "ceil"

/**
 * Convert USD to integer sats at a spot price.
 *
 * Returns null when bitcoin cannot be priced (non-positive or non-finite) or
 * the sat count does not fit in a safe integer — the caller must not pretend
 * the trade happened. Returns 0 when the amount is not a positive number, or
 * when a floored purchase is worth less than one sat.
 */
function usdToSats(usd: number, priceUsd: number, round: SatRound): number | null {
  if (!(typeof usd === "number" && usd > 0)) return 0
  if (!priceIsUsable(priceUsd)) return null
  const usdMicros = Math.round(usd * USD_MICROS)
  const priceMicros = Math.round(priceUsd * USD_MICROS)
  if (
    !Number.isSafeInteger(usdMicros) ||
    !Number.isSafeInteger(priceMicros) ||
    priceMicros <= 0
  ) {
    const raw = (usd * SATS_PER_BTC) / priceUsd
    if (!Number.isFinite(raw) || raw <= 0) return null
    const nearest = Math.round(raw)
    const sats =
      Math.abs(raw - nearest) <= 1e-6
        ? nearest
        : round === "ceil"
          ? Math.ceil(raw)
          : Math.floor(raw)
    if (!Number.isSafeInteger(sats) || sats < 0) return null
    return sats
  }
  const usdB = BigInt(usdMicros)
  const priceB = BigInt(priceMicros)
  const perBtc = BigInt(SATS_PER_BTC)
  const sats = round === "ceil" ? (usdB * perBtc + priceB - BigInt(1)) / priceB : (usdB * perBtc) / priceB
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(sats)
}

/** Sats a dollar amount represents. Unpriced → 0. Too large to count → Infinity. */
function satsForDollars(usd: number, priceUsd: number, round: SatRound): number {
  if (!(usd > 0)) return 0
  const sats = usdToSats(usd, priceUsd, round)
  if (sats === null) return priceIsUsable(priceUsd) ? Infinity : 0
  return sats
}

/** Value a positive sat count in USD. Unpriced bitcoin marks at 0; +Infinity sats stays Infinity. */
function satsToUsd(sats: number, priceUsd: number): number {
  if (sats === Infinity) return Infinity
  if (!Number.isFinite(sats) || !(sats > 0)) return 0
  if (!priceIsUsable(priceUsd)) return 0
  return (sats / SATS_PER_BTC) * priceUsd
}

export interface RunwayGapScenarioInput {
  id: string
  label: string
  /** Monthly living delta; negative when a bill shrinks (frees savings). */
  monthlyDeltaUsd: number
  /** One-time effect: positive = proceeds (reduce need); negative = cost. */
  oneTimeUsd: number
}

export interface RunwayGapInput {
  /** Months from today until the quit date. 0 = quit today / already on runway. */
  monthsUntilQuit: number
  /** Flat paycheck net savings into the stack each month (no raise). */
  monthlySavingsUsd: number
  /**
   * Extra dollars per month the "return to usual" projection adds on top of
   * monthly savings (flexible envelopes stop feeding the stack). Caller-supplied
   * numeric input; pass 0 when there is nothing extra to model.
   */
  flexibleCutMonthlyUsd: number
  /** Spot bitcoin price (USD per BTC) used for the projection and valuations. */
  btcPriceUsd: number

  // Holdings today (resolved by A1 — cashUsd, spendableSats).
  cashUsd: number
  spendableSats: number

  /**
   * Cash floor target used both for floor-first allocation and for the cash-gap
   * comparison. Pass the same floor the need module uses — `cashFloorUsedUsd`
   * for the operational floor, or `requiredCashAtHorizonUsd` for the
   * inflation-adjusted horizon requirement; pick one and stay consistent.
   */
  cashRequiredUsd: number
  /**
   * Required spendable bitcoin (sats) to compare the projection against — e.g.
   * `requiredBitcoinSatsSpot` from A1. May be Infinity (stress / zero price).
   */
  requiredBitcoinSats: number

  /** What-if scenarios to evaluate individually and all-together. */
  scenarios: RunwayGapScenarioInput[]
}

/** A single projection (flat, with-cuts, or scenario-adjusted). */
export interface RunwayGapProjection {
  monthsUntilQuit: number
  /** Total new money added over the period (monthly * months + one-time). */
  newSavingsUsd: number
  /** Portion of new savings directed to the cash floor. */
  toCashUsd: number
  /** Portion of new savings that bought bitcoin (USD spent). */
  toBitcoinUsd: number

  projectedCashUsd: number
  projectedSats: number

  // Cash side (always finite).
  cashGapUsd: number
  /** Signed: projected − required. Positive means ahead of the floor. */
  cashSurplusUsd: number

  // Bitcoin side (kept separate; may be Infinity).
  bitcoinGapSats: number
  /** Signed sats surplus; −Infinity when the requirement is Infinity. */
  bitcoinSurplusSats: number
  /** Bitcoin gap valued at spot; Infinity when the sats gap is Infinity. */
  bitcoinGapUsd: number
}

/** How much of each gap a scenario (or all scenarios together) closes. */
export interface RunwayGapScenarioClosure {
  id: string
  label: string
  /** Dollars freed by the monthly delta over the whole buildup. */
  fromMonthlyUsd: number
  /** One-time dollars (proceeds positive, costs negative). */
  fromOneTimeUsd: number
  /** Total extra dollars this scenario contributes (fromMonthly + fromOneTime). */
  extraUsd: number

  /** Reduction in the cash gap (negative if a net cost widens it). */
  cashGapClosedUsd: number
  /** Reduction in the bitcoin gap, in USD (negative if widened). */
  bitcoinGapClosedUsd: number
  /** Reduction in the bitcoin gap, in sats (negative if widened). */
  bitcoinGapClosedSats: number
}

export interface RunwayGapResult {
  monthsUntilQuit: number
  btcPriceUsd: number
  cashRequiredUsd: number
  requiredBitcoinSats: number

  /** Projection if the paycheck stays flat (monthly savings only). */
  flat: RunwayGapProjection
  /** Projection if flexible envelopes return to usual (savings + cuts). */
  withCuts: RunwayGapProjection
  flexibleCutMonthlyUsd: number

  /** Flat-projection cash gap + bitcoin gap valued at spot (Infinity-safe). */
  combinedDollarGapUsd: number
  /**
   * Months of the current (no-cuts) savings rate to close the combined dollar
   * shortfall. 0 when already covered; Infinity when the gap is Infinity; null
   * when savings <= 0 and a finite gap remains (it never closes).
   */
  monthsToCloseDollarGap: number | null

  /** Per-scenario closure, measured against the flat projection. */
  scenarios: RunwayGapScenarioClosure[]
  /** All scenarios applied together (aggregate extra), against the flat projection. */
  allEnabled: RunwayGapScenarioClosure
}

interface ProjectArgs {
  startCashUsd: number
  startSats: number
  monthsUntilQuit: number
  monthlyAddUsd: number
  oneTimeUsd: number
  cashRequiredUsd: number
  requiredBitcoinSats: number
  btcPriceUsd: number
}

/**
 * Project holdings forward with floor-first allocation and compute both gaps.
 *
 * New savings over the period = monthlyAdd * months + oneTime. When that total
 * is positive it fills the cash floor first, then buys bitcoin. When it is
 * negative (a net one-time cost outweighs contributions) it drains bitcoin first
 * to protect the cash floor, then cash — so a cost widens the bitcoin gap before
 * it threatens the floor.
 */
function projectStack(args: ProjectArgs): RunwayGapProjection {
  const months = sanitizeMonths(args.monthsUntilQuit)
  const monthlyAdd = finiteOrZero(args.monthlyAddUsd)
  const oneTime = finiteOrZero(args.oneTimeUsd)
  let newSavingsUsd = monthlyAdd * months + oneTime
  // A non-finite product (huge rate × huge horizon) must not become an infinite stack.
  if (!Number.isFinite(newSavingsUsd)) newSavingsUsd = 0

  const startCashUsd = finiteOrZero(args.startCashUsd)
  const startSats = sanitizeHoldingsSats(args.startSats)
  const cashRequiredUsd = sanitizeCashRequired(args.cashRequiredUsd)

  let projectedCashUsd = startCashUsd
  let projectedSats = startSats
  let toCashUsd = 0
  let toBitcoinUsd = 0

  if (newSavingsUsd >= 0) {
    const gapToFloor =
      cashRequiredUsd === Infinity ? Infinity : Math.max(0, cashRequiredUsd - startCashUsd)
    toCashUsd = Math.min(newSavingsUsd, gapToFloor)
    toBitcoinUsd = newSavingsUsd - toCashUsd
    const bought = usdToSats(toBitcoinUsd, args.btcPriceUsd, "floor")
    const summed = bought === null ? null : startSats + bought
    if (bought === null || summed === null || !Number.isSafeInteger(summed)) {
      // Can't price the coins, or the sat count doesn't fit. Keep the dollars
      // as cash so the stack doesn't silently lose them (and so an overflow
      // can't look like infinite bitcoin that closes the gap).
      projectedCashUsd = startCashUsd + toCashUsd + toBitcoinUsd
      projectedSats = startSats
      toCashUsd += toBitcoinUsd
      toBitcoinUsd = 0
    } else {
      projectedCashUsd = startCashUsd + toCashUsd
      projectedSats = summed
    }
  } else {
    // Net drain: sell bitcoin first (protect the floor), then cash.
    // Ceil the sale so a fraction of a sat is not taken out of a floor that
    // is already met. The leg is the mark of the sats actually removed, which
    // can be up to one sat more than the dollar drain.
    const drainUsd = -newSavingsUsd
    const sale = usdToSats(drainUsd, args.btcPriceUsd, "ceil")
    let satsRemoved = 0
    if (sale === null) {
      // Unpriced: sell nothing. A usable price whose sale doesn't fit in a
      // safe integer is larger than any balance we can count — sell what we have.
      if (priceIsUsable(args.btcPriceUsd)) satsRemoved = startSats
    } else {
      satsRemoved = Math.min(startSats, sale)
    }
    projectedSats = startSats - satsRemoved
    const drainedBitcoinUsd = satsToUsd(satsRemoved, args.btcPriceUsd)
    const remainingDrainUsd = Math.max(0, drainUsd - drainedBitcoinUsd)
    projectedCashUsd = startCashUsd - remainingDrainUsd
    // Avoid -0 for clean equality when nothing was drained from a side.
    toBitcoinUsd = drainedBitcoinUsd === 0 ? 0 : -drainedBitcoinUsd
    toCashUsd = remainingDrainUsd === 0 ? 0 : -remainingDrainUsd
  }

  const cashSurplusUsd = projectedCashUsd - cashRequiredUsd
  const cashGapUsd = cashRequiredUsd === Infinity ? Infinity : Math.max(0, -cashSurplusUsd)

  const reqSats = sanitizeRequiredSats(args.requiredBitcoinSats)
  const bitcoinGapSats = Number.isFinite(reqSats)
    ? Math.max(0, reqSats - projectedSats)
    : Infinity
  const bitcoinSurplusSats = Number.isFinite(reqSats) ? projectedSats - reqSats : -Infinity
  const bitcoinGapUsd = Number.isFinite(bitcoinGapSats)
    ? satsToUsd(bitcoinGapSats, args.btcPriceUsd)
    : Infinity

  return {
    monthsUntilQuit: months,
    newSavingsUsd,
    toCashUsd,
    toBitcoinUsd,
    projectedCashUsd,
    projectedSats,
    cashGapUsd,
    cashSurplusUsd,
    bitcoinGapSats,
    bitcoinSurplusSats,
    bitcoinGapUsd,
  }
}

/**
 * Apply a scenario's extra dollars against the flat-projection gaps. Positive
 * extra closes the cash gap first, then the bitcoin gap (floor-first). Negative
 * extra (a net cost) is absorbed by any bitcoin surplus first (spending down
 * sats you already hold above the requirement doesn't widen the gap); only the
 * remainder beyond the surplus widens the bitcoin gap, reported as negative
 * closure. The cash floor is always protected.
 */
function closeGaps(
  extraUsd: number,
  cashGapUsd: number,
  bitcoinGapUsd: number,
  bitcoinSurplusUsd: number,
  btcPriceUsd: number,
): { cashGapClosedUsd: number; bitcoinGapClosedUsd: number; bitcoinGapClosedSats: number } {
  if (!Number.isFinite(extraUsd) || extraUsd === 0) {
    return { cashGapClosedUsd: 0, bitcoinGapClosedUsd: 0, bitcoinGapClosedSats: 0 }
  }
  if (extraUsd > 0) {
    const cashGapClosedUsd = Math.min(cashGapUsd, extraUsd)
    const remainingUsd = extraUsd - cashGapClosedUsd
    const bitcoinGapClosedUsd = Number.isFinite(bitcoinGapUsd)
      ? Math.min(bitcoinGapUsd, remainingUsd)
      : remainingUsd
    const bitcoinGapClosedSats = satsForDollars(bitcoinGapClosedUsd, btcPriceUsd, "floor")
    return { cashGapClosedUsd, bitcoinGapClosedUsd, bitcoinGapClosedSats }
  }
  // Net cost: bitcoin is drained to protect the cash floor. A surplus of sats
  // above the requirement absorbs the cost first (the gap stays 0); only the
  // cost beyond the surplus actually widens the bitcoin gap.
  const costUsd = -extraUsd
  const surplusUsd = Math.max(0, bitcoinSurplusUsd)
  const gapWidenedUsd = Math.max(0, costUsd - surplusUsd)
  // Avoid -0 when the surplus fully absorbs the cost (clean equality in tests).
  const bitcoinGapClosedUsd = gapWidenedUsd === 0 ? 0 : -gapWidenedUsd
  const widenedSats = satsForDollars(gapWidenedUsd, btcPriceUsd, "ceil")
  const bitcoinGapClosedSats =
    widenedSats === 0 ? 0 : widenedSats === Infinity ? -Infinity : -widenedSats
  return { cashGapClosedUsd: 0, bitcoinGapClosedUsd, bitcoinGapClosedSats }
}

export function computeRunwayGap(input: RunwayGapInput): RunwayGapResult {
  const months = sanitizeMonths(input.monthsUntilQuit)
  const monthlySavingsUsd = finiteOrZero(input.monthlySavingsUsd)
  const flexibleCutMonthlyUsd = finiteOrZero(input.flexibleCutMonthlyUsd)
  const cashUsd = finiteOrZero(input.cashUsd)
  const spendableSats = sanitizeHoldingsSats(input.spendableSats)
  const cashRequiredUsd = sanitizeCashRequired(input.cashRequiredUsd)
  const requiredBitcoinSats = sanitizeRequiredSats(input.requiredBitcoinSats)
  // Keep a real non-positive price visible. Non-finite prices cannot be used
  // and are reported as 0 so the result itself is not NaN.
  const btcPriceUsd = priceIsUsable(input.btcPriceUsd)
    ? input.btcPriceUsd
    : Number.isFinite(input.btcPriceUsd)
      ? input.btcPriceUsd
      : 0

  const base = {
    startCashUsd: cashUsd,
    startSats: spendableSats,
    monthsUntilQuit: months,
    oneTimeUsd: 0,
    cashRequiredUsd,
    requiredBitcoinSats,
    btcPriceUsd,
  }

  const flat = projectStack({ ...base, monthlyAddUsd: monthlySavingsUsd })
  const withCutsMonthly = monthlySavingsUsd + flexibleCutMonthlyUsd
  const withCuts = projectStack({
    ...base,
    monthlyAddUsd: Number.isFinite(withCutsMonthly) ? withCutsMonthly : 0,
  })

  // Combined dollar view uses the flat projection (current savings rate).
  const combinedDollarGapUsd = Number.isFinite(flat.bitcoinGapUsd)
    ? flat.cashGapUsd + flat.bitcoinGapUsd
    : Infinity

  let monthsToCloseDollarGap: number | null
  if (combinedDollarGapUsd <= 0) {
    monthsToCloseDollarGap = 0
  } else if (monthlySavingsUsd > 0) {
    monthsToCloseDollarGap = Number.isFinite(combinedDollarGapUsd)
      ? combinedDollarGapUsd / monthlySavingsUsd
      : Infinity
  } else {
    // Savings <= 0 and a finite gap remains: it never closes.
    // An infinite gap still never closes when nothing is being saved.
    monthsToCloseDollarGap = Number.isFinite(combinedDollarGapUsd) ? null : Infinity
  }

  // USD value of any bitcoin held above the requirement in the flat projection.
  // A net cost eats this surplus before it can widen the bitcoin gap.
  // -Infinity surplus (Infinity requirement) means no surplus to spend down.
  const flatBitcoinSurplusUsd = Number.isFinite(flat.bitcoinSurplusSats)
    ? satsToUsd(Math.max(0, flat.bitcoinSurplusSats), btcPriceUsd)
    : 0

  const scenarioInputs = input.scenarios.map((s) => ({
    id: s.id,
    label: s.label,
    monthlyDeltaUsd: finiteOrZero(s.monthlyDeltaUsd),
    oneTimeUsd: finiteOrZero(s.oneTimeUsd),
  }))

  const scenarioClosure = (
    id: string,
    label: string,
    monthlyDeltaUsd: number,
    oneTimeUsd: number,
  ): RunwayGapScenarioClosure => {
    const fromMonthlyUsd = -monthlyDeltaUsd * months
    const fromOneTimeUsd = oneTimeUsd
    const extraUsd = fromMonthlyUsd + fromOneTimeUsd
    const closed = closeGaps(
      extraUsd,
      flat.cashGapUsd,
      flat.bitcoinGapUsd,
      flatBitcoinSurplusUsd,
      btcPriceUsd,
    )
    return {
      id,
      label,
      fromMonthlyUsd,
      fromOneTimeUsd,
      extraUsd,
      cashGapClosedUsd: closed.cashGapClosedUsd,
      bitcoinGapClosedUsd: closed.bitcoinGapClosedUsd,
      bitcoinGapClosedSats: closed.bitcoinGapClosedSats,
    }
  }

  const scenarios = scenarioInputs.map((s) =>
    scenarioClosure(s.id, s.label, s.monthlyDeltaUsd, s.oneTimeUsd),
  )

  const aggMonthlyDelta = scenarioInputs.reduce((sum, s) => sum + s.monthlyDeltaUsd, 0)
  const aggOneTime = scenarioInputs.reduce((sum, s) => sum + s.oneTimeUsd, 0)
  const allEnabled = scenarioClosure("all", "All scenarios", aggMonthlyDelta, aggOneTime)

  return {
    monthsUntilQuit: months,
    btcPriceUsd,
    cashRequiredUsd,
    requiredBitcoinSats,
    flat,
    withCuts,
    flexibleCutMonthlyUsd,
    combinedDollarGapUsd,
    monthsToCloseDollarGap,
    scenarios,
    allEnabled,
  }
}
