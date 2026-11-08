// Pure math for the Runway risk questionnaire.
//
// Three plain-language questions map to concrete, testable budgeting knobs:
//   1. What would you do if bitcoin fell by half and stayed there a year?
//   2. How much of your savings do you want held in bitcoin?
//   3. Would you ever borrow against bitcoin instead of selling it?
//
// No Prisma, no React, no wallet imports — this module only does arithmetic on
// the answers so both the server and the client can reuse it.

/** If bitcoin fell by half and stayed there a year: wait it out / cut spending / sell some. */
export type DipResponse = "wait" | "cut" | "sell"

/** How much of savings the user wants held in bitcoin: a little / about half / most. */
export type BtcSharePreference = "little" | "half" | "most"

/** Borrowing against bitcoin rather than selling: never / only in a deep drop / fine any time. */
export type BorrowStance = "never" | "deep_drop" | "ok"

export interface RiskAnswers {
  dipResponse: DipResponse
  btcSharePreference: BtcSharePreference
  borrowStance: BorrowStance
}

/** Middle-of-the-road profile used when a question is unanswered. */
export const DEFAULT_RISK_ANSWERS: RiskAnswers = {
  dipResponse: "cut",
  btcSharePreference: "half",
  borrowStance: "deep_drop",
}

/** Hard ceilings for the recommended cash floor (months of monthly draw). */
export const MAX_CASH_FLOOR_MONTHS = 18
export const MAX_EXTRA_CASH_FLOOR_MONTHS = 6

/** Target fraction of savings held in bitcoin for each preference. */
export function targetBtcShare(answers: RiskAnswers): number {
  switch (answers.btcSharePreference) {
    case "little":
      return 0.2
    case "half":
      return 0.5
    case "most":
      return 0.8
    default: {
      const _exhaustive: never = answers.btcSharePreference
      throw new Error(`Unhandled btcSharePreference: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Base cash floor expressed in months of monthly draw.
 * Selling in a dip is the most cautious stance → hold the most cash;
 * waiting it out is the boldest → hold the least.
 */
export function baseCashFloorMonths(answers: RiskAnswers): number {
  switch (answers.dipResponse) {
    case "sell":
      return 12 // cautious
    case "cut":
      return 6 // balanced
    case "wait":
      return 3 // bold
    default: {
      const _exhaustive: never = answers.dipResponse
      throw new Error(`Unhandled dipResponse: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Recommended cash floor in months of monthly draw.
 *
 * Start from the base months implied by the dip response. When the user is
 * actually holding *more* bitcoin than their target share, add a cushion:
 *
 *   extra = min(MAX_EXTRA_CASH_FLOOR_MONTHS, ceil((actualShare - targetShare) * 10))
 *
 * So every 10 percentage points over target adds roughly one month, capped at
 * +6 months, and the total is capped at MAX_CASH_FLOOR_MONTHS (18).
 */
export function recommendCashFloorMonths(
  answers: RiskAnswers,
  actualBtcShare: number,
  target: number,
): number {
  const base = baseCashFloorMonths(answers)
  let extra = 0
  if (actualBtcShare > target) {
    extra = Math.min(
      MAX_EXTRA_CASH_FLOOR_MONTHS,
      Math.ceil((actualBtcShare - target) * 10),
    )
  }
  return Math.min(MAX_CASH_FLOOR_MONTHS, base + extra)
}

/** Borrow cap as a fraction of unencumbered bitcoin VALUE (not a sats fraction). */
export function recommendBorrowCapFraction(answers: RiskAnswers): number {
  switch (answers.borrowStance) {
    case "never":
      return 0
    case "deep_drop":
      return 0.25
    case "ok":
      return 0.4
    default: {
      const _exhaustive: never = answers.borrowStance
      throw new Error(`Unhandled borrowStance: ${String(_exhaustive)}`)
    }
  }
}

/** Fill any missing answers with the middle-path defaults. */
export function resolveRiskAnswers(answers?: Partial<RiskAnswers> | null): RiskAnswers {
  return {
    dipResponse: answers?.dipResponse ?? DEFAULT_RISK_ANSWERS.dipResponse,
    btcSharePreference:
      answers?.btcSharePreference ?? DEFAULT_RISK_ANSWERS.btcSharePreference,
    borrowStance: answers?.borrowStance ?? DEFAULT_RISK_ANSWERS.borrowStance,
  }
}

export interface RiskProfile {
  answers: RiskAnswers
  targetBtcShare: number
  cashFloorMonthsBase: number
  borrowCapFraction: number
}

/** Resolve a (possibly partial / missing) answer set into a full risk profile. */
export function resolveRiskProfile(answers?: Partial<RiskAnswers> | null): RiskProfile {
  const resolved = resolveRiskAnswers(answers)
  return {
    answers: resolved,
    targetBtcShare: targetBtcShare(resolved),
    cashFloorMonthsBase: baseCashFloorMonths(resolved),
    borrowCapFraction: recommendBorrowCapFraction(resolved),
  }
}

/** Recommended cash floor in dollars = months × monthly draw (0 if draw ≤ 0). */
export function recommendedCashFloorUsd(months: number, monthlyDrawUsd: number): number {
  if (monthlyDrawUsd <= 0) return 0
  return months * monthlyDrawUsd
}
