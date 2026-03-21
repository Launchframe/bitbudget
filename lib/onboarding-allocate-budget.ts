/**
 * Monthly USD budget for envelope allocation during onboarding.
 * Bi-monthly pay (twice per month) is stored per paycheck in the income field; allocations are monthly, so ×2.
 */
export function monthlyBudgetForAllocation(
  incomeParsed: number,
  payCadence: "monthly" | "bimonthly",
): number {
  if (!Number.isFinite(incomeParsed) || incomeParsed <= 0) return 0
  return payCadence === "bimonthly" ? incomeParsed * 2 : incomeParsed
}

/** Slider / input snap step for onboarding Allocate Income (USD). */
export const ONBOARDING_ALLOCATE_SLIDER_STEP = 50
