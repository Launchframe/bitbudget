export type OnboardingPayCadence = "monthly" | "bimonthly" | "weekly" | "biweekly"

/**
 * Monthly USD budget for envelope allocation during onboarding.
 * Per-paycheck amounts are converted to a monthly equivalent for slider caps.
 */
export function monthlyBudgetForAllocation(
  incomeParsed: number,
  payCadence: OnboardingPayCadence,
): number {
  if (!Number.isFinite(incomeParsed) || incomeParsed <= 0) return 0
  switch (payCadence) {
    case "bimonthly":
      return incomeParsed * 2
    case "weekly":
      return incomeParsed * (52 / 12)
    case "biweekly":
      return incomeParsed * (26 / 12)
    default:
      return incomeParsed
  }
}

/** Monthly capacity when income is irregular-only or mixed with an annual estimate. */
export function monthlyCapacityFromAnnualEstimate(estimatedAnnual: number): number {
  if (!Number.isFinite(estimatedAnnual) || estimatedAnnual <= 0) return 0
  return estimatedAnnual / 12
}

/** Percent of one entered paycheck that a monthly savings goal represents; null when no paycheck. */
export function savingsGoalPercentOfPaycheck(
  savingsGoalMonthly: number,
  paycheckAmount: number,
): number | null {
  if (!Number.isFinite(paycheckAmount) || paycheckAmount <= 0) return null
  if (!Number.isFinite(savingsGoalMonthly) || savingsGoalMonthly < 0) return null
  return Math.round((savingsGoalMonthly / paycheckAmount) * 100)
}

/**
 * Coarse step (USD) for Allocate Income: displayed $ / % and stacked bar update when the slider
 * crosses midpoints `step * i + step/2` (e.g. …, 25, 75, 125, … for $50 steps).
 */
export const ONBOARDING_ALLOCATE_SLIDER_STEP = 50

/** Per-envelope monthly cap when onboarding has no income estimate (free-form allocation). */
export const ONBOARDING_UNBOUNDED_ALLOC_MAX = 50_000

/** True when the user skipped income estimates — allocations are not capped to a monthly total. */
export function isUnboundedOnboardingAllocation(monthlyBudget: number): boolean {
  return !Number.isFinite(monthlyBudget) || monthlyBudget <= 0
}

/** Slider `max` for one envelope row (bounded = allotment + remaining pool; unbounded = fixed cap). */
export function onboardingSliderMaxForRow(
  monthlyAllotment: number,
  savingsRemaining: number,
  monthlyBudget: number,
): number {
  if (isUnboundedOnboardingAllocation(monthlyBudget)) return ONBOARDING_UNBOUNDED_ALLOC_MAX
  return monthlyAllotment + savingsRemaining
}

/** Max monthly allotment one row may reach (respects shared budget when bounded). */
export function onboardingAllocationCapForRow(
  monthlyBudget: number,
  otherRowsAllocatedMonthly: number,
): number {
  if (isUnboundedOnboardingAllocation(monthlyBudget)) return ONBOARDING_UNBOUNDED_ALLOC_MAX
  return Math.max(0, monthlyBudget - otherRowsAllocatedMonthly)
}

/**
 * Round `raw` to the nearest `step` (default $50), clamp to `[0, max]`.
 * After rounding, clamp again so values like 997 stay at 997 when nearest step is 1000.
 */
export function snapOnboardingAllocationToStep(
  raw: number,
  max: number,
  step: number = ONBOARDING_ALLOCATE_SLIDER_STEP,
): number {
  if (!Number.isFinite(max) || max <= 0) return 0
  if (!Number.isFinite(raw) || !Number.isFinite(step) || step <= 0) return 0
  const clamped = Math.min(max, Math.max(0, raw))
  const snapped = Math.round(clamped / step) * step
  return Math.min(max, Math.max(0, snapped))
}
