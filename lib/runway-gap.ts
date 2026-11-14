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
// Infinity handling: when the required bitcoin side is Infinity (A1 returns this
// under a 100% stress drop / non-positive price), the bitcoin gap stays Infinity
// in both sats and USD and never produces NaN. `monthsToCloseDollarGap` then
// also surfaces as Infinity.

const SATS_PER_BTC = 1e8

/** Convert a USD amount to integer sats at a spot price. Non-positive price or
 * amount yields 0 sats (bitcoin cannot be bought / valued). Floored to keep the
 * projected balance conservative. */
function usdToSats(usd: number, priceUsd: number): number {
  if (usd <= 0 || priceUsd <= 0) return 0
  return Math.max(0, Math.floor((usd / priceUsd) * SATS_PER_BTC))
}

/** Value a sats amount in USD at a spot price; Infinity sats stays Infinity. */
function satsToUsd(sats: number, priceUsd: number): number {
  if (!Number.isFinite(sats)) return Infinity
  return (sats / SATS_PER_BTC) * Math.max(0, priceUsd)
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
  const months = Math.max(0, args.monthsUntilQuit)
  const newSavingsUsd = args.monthlyAddUsd * months + args.oneTimeUsd

  let projectedCashUsd = args.startCashUsd
  let projectedSats = args.startSats
  let toCashUsd = 0
  let toBitcoinUsd = 0

  if (newSavingsUsd >= 0) {
    const gapToFloor = Math.max(0, args.cashRequiredUsd - args.startCashUsd)
    toCashUsd = Math.min(newSavingsUsd, gapToFloor)
    toBitcoinUsd = newSavingsUsd - toCashUsd
    if (args.btcPriceUsd > 0) {
      projectedCashUsd = args.startCashUsd + toCashUsd
      projectedSats = args.startSats + usdToSats(toBitcoinUsd, args.btcPriceUsd)
    } else {
      // Bitcoin can't be bought at a non-positive price. Keep those dollars as
      // cash so the projected stack doesn't silently lose value; the bitcoin
      // gap stays whatever it was (no sats added).
      projectedCashUsd = args.startCashUsd + toCashUsd + toBitcoinUsd
      projectedSats = args.startSats
      toCashUsd += toBitcoinUsd
      toBitcoinUsd = 0
    }
  } else {
    // Net drain: take it out of bitcoin first (protect the floor), then cash.
    const drainUsd = -newSavingsUsd
    const drainSats = usdToSats(drainUsd, args.btcPriceUsd)
    const satsRemoved = Math.min(args.startSats, drainSats)
    projectedSats = args.startSats - satsRemoved
    const drainedBitcoinUsd = satsToUsd(satsRemoved, args.btcPriceUsd)
    const remainingDrainUsd = Math.max(0, drainUsd - drainedBitcoinUsd)
    projectedCashUsd = args.startCashUsd - remainingDrainUsd
    // Avoid -0 for clean equality when nothing was drained from a side.
    toBitcoinUsd = drainedBitcoinUsd === 0 ? 0 : -drainedBitcoinUsd
    toCashUsd = remainingDrainUsd === 0 ? 0 : -remainingDrainUsd
  }

  const cashSurplusUsd = projectedCashUsd - args.cashRequiredUsd
  const cashGapUsd = Math.max(0, -cashSurplusUsd)

  const reqSats = args.requiredBitcoinSats
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
  if (extraUsd >= 0) {
    const cashGapClosedUsd = Math.min(cashGapUsd, extraUsd)
    const remainingUsd = extraUsd - cashGapClosedUsd
    const bitcoinGapClosedUsd = Number.isFinite(bitcoinGapUsd)
      ? Math.min(bitcoinGapUsd, remainingUsd)
      : remainingUsd
    const bitcoinGapClosedSats = usdToSats(bitcoinGapClosedUsd, btcPriceUsd)
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
  const widenedSats = usdToSats(gapWidenedUsd, btcPriceUsd)
  const bitcoinGapClosedSats = widenedSats === 0 ? 0 : -widenedSats
  return { cashGapClosedUsd: 0, bitcoinGapClosedUsd, bitcoinGapClosedSats }
}

export function computeRunwayGap(input: RunwayGapInput): RunwayGapResult {
  const months = Math.max(0, input.monthsUntilQuit)

  const base = {
    startCashUsd: input.cashUsd,
    startSats: input.spendableSats,
    monthsUntilQuit: months,
    oneTimeUsd: 0,
    cashRequiredUsd: input.cashRequiredUsd,
    requiredBitcoinSats: input.requiredBitcoinSats,
    btcPriceUsd: input.btcPriceUsd,
  }

  const flat = projectStack({ ...base, monthlyAddUsd: input.monthlySavingsUsd })
  const withCuts = projectStack({
    ...base,
    monthlyAddUsd: input.monthlySavingsUsd + input.flexibleCutMonthlyUsd,
  })

  // Combined dollar view uses the flat projection (current savings rate).
  const combinedDollarGapUsd = Number.isFinite(flat.bitcoinGapUsd)
    ? flat.cashGapUsd + flat.bitcoinGapUsd
    : Infinity

  let monthsToCloseDollarGap: number | null
  if (combinedDollarGapUsd <= 0) {
    monthsToCloseDollarGap = 0
  } else if (input.monthlySavingsUsd > 0) {
    monthsToCloseDollarGap = combinedDollarGapUsd / input.monthlySavingsUsd
  } else {
    // Savings <= 0 and a finite gap remains: it never closes.
    monthsToCloseDollarGap = Number.isFinite(combinedDollarGapUsd) ? null : Infinity
  }

  // USD value of any bitcoin held above the requirement in the flat projection.
  // A net cost eats this surplus before it can widen the bitcoin gap.
  // -Infinity surplus (Infinity requirement) means no surplus to spend down.
  const flatBitcoinSurplusUsd = Number.isFinite(flat.bitcoinSurplusSats)
    ? satsToUsd(flat.bitcoinSurplusSats, input.btcPriceUsd)
    : 0

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
      input.btcPriceUsd,
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

  const scenarios = input.scenarios.map((s) =>
    scenarioClosure(s.id, s.label, s.monthlyDeltaUsd, s.oneTimeUsd),
  )

  const aggMonthlyDelta = input.scenarios.reduce((sum, s) => sum + s.monthlyDeltaUsd, 0)
  const aggOneTime = input.scenarios.reduce((sum, s) => sum + s.oneTimeUsd, 0)
  const allEnabled = scenarioClosure("all", "All scenarios", aggMonthlyDelta, aggOneTime)

  return {
    monthsUntilQuit: months,
    btcPriceUsd: input.btcPriceUsd,
    cashRequiredUsd: input.cashRequiredUsd,
    requiredBitcoinSats: input.requiredBitcoinSats,
    flat,
    withCuts,
    flexibleCutMonthlyUsd: input.flexibleCutMonthlyUsd,
    combinedDollarGapUsd,
    monthsToCloseDollarGap,
    scenarios,
    allEnabled,
  }
}
