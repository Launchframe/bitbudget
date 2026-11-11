// Pure math for the "expense impact" previews (B5).
//
// Two independent read-outs the New Transaction dialog and the dashboard show
// when a user is logging / considering an expense:
//
//   1. Savings-goal impact — does this expense put this month's savings goal
//      out of reach (even spending nothing else), or merely leave them behind
//      straight-line pace with a later paycheck still able to catch up?
//   2. Runway months-left impact — how many months of runway a one-time expense
//      costs, valued at spot (and optionally a stress / growth bitcoin mark).
//
// No React, no Prisma, no network. Everything takes plain numbers so the dialog
// and dashboard can reuse it and it stays unit-testable. Inputs degrade
// silently: missing/zero/NaN data yields a "nothing to say" result rather than
// throwing or inventing a number.

/** Half-a-cent tolerance so floating dust never trips an "out of reach" line. */
const CENT_EPSILON = 0.005

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function finiteOr(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

// ---------------------------------------------------------------------------
// Savings-goal impact
// ---------------------------------------------------------------------------

export type GoalImpactStatus = "none" | "out_of_reach" | "behind_pace"

export interface GoalImpactInput {
  /** This month's savings goal in USD. 0 / unset means "no goal" → status none. */
  goalUsd: number
  /** Dollars already kept toward the goal this month (never negative). */
  keptSoFarUsd: number
  /** Income still expected to arrive this month (e.g. a later paycheck). */
  incomeStillExpectedUsd: number
  /**
   * An expense being logged / considered. It reduces what can still be kept
   * this month. Default 0 (used for the plain dashboard read-out).
   */
  expenseUsd?: number
  /**
   * Fraction of the month elapsed (0..1) for the straight-line pace check.
   * Omit to skip the behind-pace read-out entirely.
   */
  monthProgress?: number | null
}

export interface GoalImpactResult {
  status: GoalImpactStatus
  /** How far past reach the goal is, even spending nothing else (>0 only when out_of_reach). */
  outOfReachByUsd: number
  /** How far below straight-line pace (>0 only when behind_pace). */
  behindPaceByUsd: number
  /** The most that can still be kept this month after the expense (floored at 0). */
  achievableUsd: number
}

const NO_GOAL_IMPACT: GoalImpactResult = {
  status: "none",
  outOfReachByUsd: 0,
  behindPaceByUsd: 0,
  achievableUsd: 0,
}

/**
 * Decide whether an expense (or the current state, with expenseUsd = 0) puts
 * this month's savings goal out of reach, or merely behind pace.
 *
 * Out of reach: goal − (kept + income still expected − expense) > 0. The user
 * cannot hit the goal this month even if they spend nothing else.
 *
 * Behind pace: not out of reach, but what's kept right now (after the expense)
 * is below where straight-line pace says they should be, AND there is still
 * income expected this month that could catch them up. This is the quieter,
 * reassuring case.
 */
export function computeGoalImpact(input: GoalImpactInput): GoalImpactResult {
  const goal = finiteOr(input.goalUsd, 0)
  if (goal <= 0) return NO_GOAL_IMPACT

  const kept = Math.max(0, finiteOr(input.keptSoFarUsd, 0))
  const income = Math.max(0, finiteOr(input.incomeStillExpectedUsd, 0))
  const expense = Math.max(0, finiteOr(input.expenseUsd, 0))

  const achievableUsd = Math.max(0, kept + income - expense)
  const shortfall = goal - (kept + income - expense)

  if (shortfall > CENT_EPSILON) {
    return {
      status: "out_of_reach",
      outOfReachByUsd: round2(shortfall),
      behindPaceByUsd: 0,
      achievableUsd: round2(achievableUsd),
    }
  }

  // Still reachable. Only surface a behind-pace nudge when a later paycheck
  // could close the gap (income still expected) and we have a month-progress
  // fraction to compare against.
  if (input.monthProgress != null && Number.isFinite(input.monthProgress) && income > CENT_EPSILON) {
    const paceTarget = goal * clamp01(input.monthProgress)
    const keptAfter = Math.max(0, kept - expense)
    const behind = paceTarget - keptAfter
    if (behind > CENT_EPSILON) {
      return {
        status: "behind_pace",
        outOfReachByUsd: 0,
        behindPaceByUsd: round2(behind),
        achievableUsd: round2(achievableUsd),
      }
    }
  }

  return { ...NO_GOAL_IMPACT, achievableUsd: round2(achievableUsd) }
}

// ---------------------------------------------------------------------------
// Runway months-left impact
// ---------------------------------------------------------------------------

export interface MonthsLeftImpactInput {
  /**
   * Liquid dollars that fund the monthly draw today, valued at spot — i.e. cash
   * above the floor plus spendable bitcoin at the spot price. This is
   * `monthsLeft * monthlyDrawUsd` from the runway need result.
   */
  liquidTodayUsd: number
  /** Monthly draw the user must cover from their own stack. 0 → not meaningful. */
  monthlyDrawUsd: number
  /** The one-time expense being considered. */
  expenseUsd: number
  /** Same liquid pool valued with a stressed bitcoin mark (optional). */
  liquidStressUsd?: number | null
  /** Same liquid pool valued with a growth bitcoin mark (optional). */
  liquidGrowthUsd?: number | null
}

export interface MonthsLeftImpactResult {
  /** True when a months-left read-out is meaningful (positive monthly draw). */
  available: boolean
  monthsBefore: number | null
  monthsAfter: number | null
  /** monthsBefore − monthsAfter (≥ 0); null when not available. */
  deltaMonths: number | null
  monthsBeforeStress: number | null
  monthsAfterStress: number | null
  monthsBeforeGrowth: number | null
  monthsAfterGrowth: number | null
}

const NO_MONTHS_IMPACT: MonthsLeftImpactResult = {
  available: false,
  monthsBefore: null,
  monthsAfter: null,
  deltaMonths: null,
  monthsBeforeStress: null,
  monthsAfterStress: null,
  monthsBeforeGrowth: null,
  monthsAfterGrowth: null,
}

/**
 * How many months of runway a one-time expense costs. Months = liquid ÷ draw;
 * the expense comes straight off the liquid pool. Floored at 0. Degrades to an
 * "unavailable" result when the monthly draw is non-positive or inputs are not
 * finite (e.g. income still covers living, so there is no draw to shorten).
 */
export function computeMonthsLeftImpact(
  input: MonthsLeftImpactInput,
): MonthsLeftImpactResult {
  const draw = finiteOr(input.monthlyDrawUsd, 0)
  if (draw <= 0) return NO_MONTHS_IMPACT

  const expense = Math.max(0, finiteOr(input.expenseUsd, 0))

  const monthsFrom = (liquid: number | null | undefined): number | null => {
    if (liquid == null || !Number.isFinite(liquid)) return null
    return Math.max(0, liquid) / draw
  }
  const monthsAfterFrom = (liquid: number | null | undefined): number | null => {
    if (liquid == null || !Number.isFinite(liquid)) return null
    return Math.max(0, Math.max(0, liquid) - expense) / draw
  }

  const monthsBefore = monthsFrom(input.liquidTodayUsd)
  const monthsAfter = monthsAfterFrom(input.liquidTodayUsd)
  if (monthsBefore == null || monthsAfter == null) return NO_MONTHS_IMPACT

  return {
    available: true,
    monthsBefore,
    monthsAfter,
    deltaMonths: Math.max(0, monthsBefore - monthsAfter),
    monthsBeforeStress: monthsFrom(input.liquidStressUsd),
    monthsAfterStress: monthsAfterFrom(input.liquidStressUsd),
    monthsBeforeGrowth: monthsFrom(input.liquidGrowthUsd),
    monthsAfterGrowth: monthsAfterFrom(input.liquidGrowthUsd),
  }
}

/**
 * Whether an expense is "large" relative to how much the user usually spends in
 * that envelope each month — the trigger for showing the extra growth-rate line.
 * Needs a positive usual figure to compare against; otherwise not large.
 */
export function isLargeExpense(
  expenseUsd: number,
  envelopeUsualMonthlyUsd: number,
  factor = 1.5,
): boolean {
  const expense = finiteOr(expenseUsd, 0)
  const usual = finiteOr(envelopeUsualMonthlyUsd, 0)
  if (expense <= 0 || usual <= 0) return false
  return expense >= usual * factor
}

/**
 * Plain-language month count for UI copy. Rounds to whole months with an
 * "about" qualifier; collapses tiny remainders to "under a month".
 */
export function formatMonthsLeft(months: number | null): string {
  if (months == null || !Number.isFinite(months) || months < 0) return "—"
  if (months < 0.5) return "under a month"
  const whole = Math.round(months)
  return `about ${whole} month${whole === 1 ? "" : "s"}`
}
