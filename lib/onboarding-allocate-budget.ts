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

/**
 * Starting slider range when onboarding has no income estimate.
 * Doubles (1000 → 2000 → 4000 → …) as the user allocates toward the current max.
 */
export const ONBOARDING_UNBOUNDED_SLIDER_FLOOR = 1_000

/** Max typed monthly allotment per envelope in unbounded onboarding (matches Decimal(12, 2)). */
export const ONBOARDING_UNBOUNDED_INPUT_MAX = 9_999_999

/** @deprecated Use ONBOARDING_UNBOUNDED_SLIDER_FLOOR or ONBOARDING_UNBOUNDED_INPUT_MAX. */
export const ONBOARDING_UNBOUNDED_ALLOC_MAX = ONBOARDING_UNBOUNDED_SLIDER_FLOOR

/** True when the user skipped income estimates — allocations are not capped to a monthly total. */
export function isUnboundedOnboardingAllocation(monthlyBudget: number): boolean {
  return !Number.isFinite(monthlyBudget) || monthlyBudget <= 0
}

/** Smallest doubling of {@link ONBOARDING_UNBOUNDED_SLIDER_FLOOR} that fits target + one slider step. */
export function unboundedOnboardingSliderMaxDragging(
  monthlyAllotment: number,
  rawPosition: number,
): number {
  const target = Math.max(Math.max(0, monthlyAllotment), Math.max(0, rawPosition))
  const needed = target + ONBOARDING_ALLOCATE_SLIDER_STEP
  let max = ONBOARDING_UNBOUNDED_SLIDER_FLOOR
  while (max < needed && max < ONBOARDING_UNBOUNDED_INPUT_MAX) {
    max *= 2
  }
  return Math.min(max, ONBOARDING_UNBOUNDED_INPUT_MAX)
}

/** Max range for one drag gesture — one doubling band above the committed allotment. */
export function unboundedOnboardingSliderMaxForGesture(monthlyAllotment: number): number {
  const amt = Math.max(0, monthlyAllotment)
  return unboundedOnboardingSliderMaxDragging(amt, amt)
}

/** Expand an in-progress unbounded drag by one doubling step (1000 → 2000 → 4000 …). */
export function unboundedOnboardingSliderNextBand(currentMax: number): number {
  if (!Number.isFinite(currentMax) || currentMax <= 0) {
    return ONBOARDING_UNBOUNDED_SLIDER_FLOOR
  }
  if (currentMax >= ONBOARDING_UNBOUNDED_INPUT_MAX) return ONBOARDING_UNBOUNDED_INPUT_MAX
  return Math.min(currentMax * 2, ONBOARDING_UNBOUNDED_INPUT_MAX)
}

export type UnboundedSliderDragInput = {
  prevRaw: number
  val: number
  activeMax: number
  expandedFromMaxes: ReadonlySet<number>
}

export type UnboundedSliderDragResult = {
  val: number
  activeMax: number
  expandedFromMaxes: Set<number>
  didExpand: boolean
}

/**
 * Advance an unbounded onboarding slider drag by at most one band.
 * When the range grows, browsers often remap the thumb to the new max in one jump — ignore that
 * so doublings do not cascade to billions in a single gesture.
 */
export function applyUnboundedOnboardingSliderDrag(
  input: UnboundedSliderDragInput,
): UnboundedSliderDragResult {
  const prevRaw = Math.max(0, input.prevRaw)
  let val = Math.max(0, input.val)
  let activeMax = Math.max(ONBOARDING_UNBOUNDED_SLIDER_FLOOR, input.activeMax)
  const expandedFromMaxes = new Set(input.expandedFromMaxes)

  const jump = val - prevRaw
  const likelyMaxRemap =
    jump > ONBOARDING_ALLOCATE_SLIDER_STEP &&
    prevRaw >= activeMax / 2 &&
    jump >= activeMax / 2

  if (likelyMaxRemap) {
    return { val: prevRaw, activeMax, expandedFromMaxes, didExpand: false }
  }

  if (val > activeMax) val = activeMax

  if (val >= activeMax && prevRaw < activeMax && !expandedFromMaxes.has(activeMax)) {
    const nextMax = unboundedOnboardingSliderNextBand(activeMax)
    if (nextMax > activeMax) {
      expandedFromMaxes.add(activeMax)
      val = activeMax
      activeMax = nextMax
      return { val, activeMax, expandedFromMaxes, didExpand: true }
    }
  }

  return { val: Math.min(activeMax, val), activeMax, expandedFromMaxes, didExpand: false }
}

/**
 * Slider max when the user is not dragging — keeps the thumb at the right edge
 * for the committed value instead of expanding to the next doubling band.
 */
export function unboundedOnboardingSliderMaxAtRest(monthlyAllotment: number): number {
  const amt = Math.max(0, monthlyAllotment)
  if (amt <= 0) return ONBOARDING_UNBOUNDED_SLIDER_FLOOR
  return Math.max(ONBOARDING_UNBOUNDED_SLIDER_FLOOR, amt)
}

/** @deprecated Use unboundedOnboardingSliderMaxDragging or unboundedOnboardingSliderMaxAtRest. */
export function unboundedOnboardingSliderMax(monthlyAllotment: number): number {
  return unboundedOnboardingSliderMaxAtRest(monthlyAllotment)
}

/**
 * Slider `max` for one envelope row at rest.
 * Bounded: allotment + remaining pool. Unbounded: tight max so thumb stays at the right edge.
 * During a drag, the UI locks {@link unboundedOnboardingSliderMaxForGesture} for the gesture.
 */
export function onboardingSliderMaxForRow(
  monthlyAllotment: number,
  savingsRemaining: number,
  monthlyBudget: number,
): number {
  if (isUnboundedOnboardingAllocation(monthlyBudget)) {
    return unboundedOnboardingSliderMaxAtRest(monthlyAllotment)
  }
  return monthlyAllotment + savingsRemaining
}

/** Max monthly allotment one row may reach (respects shared budget when bounded). */
export function onboardingAllocationCapForRow(
  monthlyBudget: number,
  otherRowsAllocatedMonthly: number,
): number {
  if (isUnboundedOnboardingAllocation(monthlyBudget)) return ONBOARDING_UNBOUNDED_INPUT_MAX
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
