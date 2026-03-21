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

/** Legacy coarse step (USD); Allocate Income slider now uses $1 steps — kept for any future coarse UI. */
export const ONBOARDING_ALLOCATE_SLIDER_STEP = 50
