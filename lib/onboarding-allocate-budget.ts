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

/**
 * Coarse step (USD) for Allocate Income: displayed $ / % and stacked bar update when the slider
 * crosses midpoints `step * i + step/2` (e.g. …, 25, 75, 125, … for $50 steps).
 */
export const ONBOARDING_ALLOCATE_SLIDER_STEP = 50

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
