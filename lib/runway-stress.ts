// Suggest a default "stress" percent for a Runway plan from historical bitcoin
// drawdowns (D2).
//
// The Runway need math applies a stress price = spotPrice * (1 - stressPercent)
// to test how far the plan survives a bitcoin crash (see lib/runway-need.ts).
// Rather than always defaulting to the middle (0.5), we can seed a *new* plan
// with a value grounded in how far bitcoin has actually fallen recently.
//
// Window & method:
//   - Look at the trailing STRESS_WINDOW_YEARS (default 4) of a daily price
//     series. Four years spans roughly one halving cycle, so it captures at
//     least one major bull/bear swing without over-weighting ancient history.
//   - Compute the maximum peak-to-trough drawdown within that window: walk the
//     window in date order, track the running peak, and record the largest
//     (peak - price) / peak.
//   - Clamp the result to a sane band [STRESS_MIN, STRESS_MAX] = [0.30, 0.70].
//     A tiny observed drawdown should not leave the plan untested, and a near-
//     total wipeout should not make the required-bitcoin math explode.
//   - If there is not enough history (too few points or too short a span), fall
//     back to STRESS_DEFAULT (0.5) and report `sufficient: false` so callers can
//     decide whether to trust it.
//
// Pure arithmetic only — no React/Prisma/network — so the server and client can
// share it. Input prices may be unsorted and may contain non-finite junk; we
// sort and filter defensively and never throw.

/** Lower bound for a suggested stress percent (never leave the plan untested). */
export const STRESS_MIN = 0.3
/** Upper bound for a suggested stress percent (keep required-bitcoin math sane). */
export const STRESS_MAX = 0.7
/** Middle-path fallback used when history is insufficient. */
export const STRESS_DEFAULT = 0.5
/** Trailing window, in years, of price history considered (~one halving cycle). */
export const STRESS_WINDOW_YEARS = 4
/** Minimum number of in-window price points required to trust a suggestion. */
export const STRESS_MIN_POINTS = 60
/** Minimum span (days) between first and last in-window points to trust it. */
export const STRESS_MIN_SPAN_DAYS = 180

const DAYS_PER_YEAR = 365.25
const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_MS = DAYS_PER_YEAR * DAY_MS

/** A single daily (or otherwise) price observation. */
export interface StressPricePoint {
  /** ISO date (`YYYY-MM-DD`) or any Date.parse-able string. */
  date: string
  /** Spot price in USD. */
  priceUsd: number
}

export interface StressSuggestion {
  /** Suggested stress percent, clamped to [STRESS_MIN, STRESS_MAX]. */
  stressPercent: number
  /** Observed max drawdown fraction (0..1) in the window, or null if insufficient. */
  maxDrawdown: number | null
  /** Whether there was enough history to base the suggestion on real drawdowns. */
  sufficient: boolean
  /** Trailing window considered, in years. */
  windowYears: number
  /** Number of in-window points used. */
  pointsUsed: number
  /** Span between first and last in-window points, in days. */
  spanDays: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Round to two decimals (whole-percent granularity). */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export interface SuggestStressOptions {
  /** Trailing window in years (default STRESS_WINDOW_YEARS). */
  windowYears?: number
  /**
   * Reference "now" for the trailing window. Defaults to the latest point's
   * date so the suggestion is deterministic for a given series in tests.
   */
  asOfMs?: number
}

/**
 * Suggest a stress percent from a historical price series.
 *
 * Returns {@link STRESS_DEFAULT} (banded middle) with `sufficient: false` when
 * the series lacks enough in-window history. Otherwise returns the window's max
 * drawdown clamped to [STRESS_MIN, STRESS_MAX].
 */
export function suggestStressFromPrices(
  prices: readonly StressPricePoint[],
  options?: SuggestStressOptions,
): StressSuggestion {
  const windowYears = options?.windowYears ?? STRESS_WINDOW_YEARS

  const insufficient = (pointsUsed: number, spanDays: number): StressSuggestion => ({
    stressPercent: STRESS_DEFAULT,
    maxDrawdown: null,
    sufficient: false,
    windowYears,
    pointsUsed,
    spanDays,
  })

  if (!Array.isArray(prices) || prices.length < 2) {
    return insufficient(prices?.length ?? 0, 0)
  }

  const sorted = prices
    .map((p) => ({ ms: Date.parse(p.date), priceUsd: p.priceUsd }))
    .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.priceUsd) && p.priceUsd > 0)
    .sort((a, b) => a.ms - b.ms)

  if (sorted.length < 2) return insufficient(sorted.length, 0)

  const asOfMs = options?.asOfMs ?? sorted[sorted.length - 1]!.ms
  const cutoffMs = asOfMs - windowYears * YEAR_MS
  const windowPoints = sorted.filter((p) => p.ms >= cutoffMs && p.ms <= asOfMs)

  if (windowPoints.length < 2) return insufficient(windowPoints.length, 0)

  const spanDays = (windowPoints[windowPoints.length - 1]!.ms - windowPoints[0]!.ms) / DAY_MS

  if (windowPoints.length < STRESS_MIN_POINTS || spanDays < STRESS_MIN_SPAN_DAYS) {
    return insufficient(windowPoints.length, Math.round(spanDays))
  }

  let peak = windowPoints[0]!.priceUsd
  let maxDrawdown = 0
  for (const point of windowPoints) {
    if (point.priceUsd > peak) peak = point.priceUsd
    if (peak > 0) {
      const drawdown = (peak - point.priceUsd) / peak
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }
  }

  const stressPercent = round2(clamp(maxDrawdown, STRESS_MIN, STRESS_MAX))

  return {
    stressPercent,
    maxDrawdown,
    sufficient: true,
    windowYears,
    pointsUsed: windowPoints.length,
    spanDays: Math.round(spanDays),
  }
}

/**
 * The stress percent to seed a brand-new plan with. A non-null suggestion wins;
 * otherwise the middle-path default. Never used to overwrite an already-saved
 * plan — only as the default a fresh plan / setup starts from.
 */
export function suggestedStressPercent(
  prices: readonly StressPricePoint[] | null | undefined,
  options?: SuggestStressOptions,
): number {
  if (!prices || prices.length === 0) return STRESS_DEFAULT
  return suggestStressFromPrices(prices, options).stressPercent
}
