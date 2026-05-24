import { describe, expect, it } from "vitest"
import {
  isUnboundedOnboardingAllocation,
  onboardingAllocationCapForRow,
  onboardingSliderMaxForRow,
  ONBOARDING_UNBOUNDED_INPUT_MAX,
  ONBOARDING_UNBOUNDED_SLIDER_FLOOR,
  unboundedOnboardingSliderMaxAtRest,
  unboundedOnboardingSliderMaxDragging,
  unboundedOnboardingSliderMaxForGesture,
  unboundedOnboardingSliderNextBand,
  applyUnboundedOnboardingSliderDrag,
  savingsGoalPercentOfPaycheck,
  snapOnboardingAllocationToStep,
} from "../onboarding-allocate-budget"

describe("onboarding allocation caps", () => {
  it("treats zero monthly budget as unbounded", () => {
    expect(isUnboundedOnboardingAllocation(0)).toBe(true)
    expect(onboardingSliderMaxForRow(0, 0, 0)).toBe(ONBOARDING_UNBOUNDED_SLIDER_FLOOR)
    expect(onboardingAllocationCapForRow(0, 5000)).toBe(ONBOARDING_UNBOUNDED_INPUT_MAX)
  })

  it("keeps unbounded slider max tight at rest so the thumb stays at the right edge", () => {
    expect(unboundedOnboardingSliderMaxAtRest(0)).toBe(1_000)
    expect(unboundedOnboardingSliderMaxAtRest(1_000)).toBe(1_000)
    expect(onboardingSliderMaxForRow(1_000, 0, 0)).toBe(1_000)
  })

  it("locks one doubling band per drag gesture", () => {
    expect(unboundedOnboardingSliderMaxForGesture(0)).toBe(1_000)
    expect(unboundedOnboardingSliderMaxForGesture(1_000)).toBe(2_000)
    expect(unboundedOnboardingSliderMaxForGesture(2_000)).toBe(4_000)
    expect(unboundedOnboardingSliderMaxForGesture(4_000)).toBe(8_000)
  })

  it("expands one band at a time when the thumb hits the ceiling", () => {
    expect(unboundedOnboardingSliderNextBand(1_000)).toBe(2_000)
    expect(unboundedOnboardingSliderNextBand(2_000)).toBe(4_000)
    expect(unboundedOnboardingSliderNextBand(ONBOARDING_UNBOUNDED_INPUT_MAX)).toBe(
      ONBOARDING_UNBOUNDED_INPUT_MAX,
    )
  })

  it("uses remaining pool when monthly budget is set", () => {
    expect(isUnboundedOnboardingAllocation(2400)).toBe(false)
    expect(onboardingSliderMaxForRow(600, 1800, 2400)).toBe(2400)
    expect(onboardingAllocationCapForRow(2400, 600)).toBe(1800)
  })
})

describe("applyUnboundedOnboardingSliderDrag", () => {
  it("expands once when the user reaches the current max from below", () => {
    const result = applyUnboundedOnboardingSliderDrag({
      prevRaw: 950,
      val: 1_000,
      activeMax: 1_000,
      expandedFromMaxes: new Set(),
    })
    expect(result.didExpand).toBe(true)
    expect(result.activeMax).toBe(2_000)
    expect(result.val).toBe(1_000)
    expect(result.expandedFromMaxes.has(1_000)).toBe(true)
  })

  it("ignores browser max-remap jumps after a band expands", () => {
    const result = applyUnboundedOnboardingSliderDrag({
      prevRaw: 1_000,
      val: 2_000,
      activeMax: 2_000,
      expandedFromMaxes: new Set([1_000]),
    })
    expect(result.didExpand).toBe(false)
    expect(result.val).toBe(1_000)
    expect(result.activeMax).toBe(2_000)
  })

  it("allows a second band when the user later reaches the new ceiling", () => {
    const result = applyUnboundedOnboardingSliderDrag({
      prevRaw: 1_950,
      val: 2_000,
      activeMax: 2_000,
      expandedFromMaxes: new Set([1_000]),
    })
    expect(result.didExpand).toBe(true)
    expect(result.activeMax).toBe(4_000)
    expect(result.val).toBe(2_000)
  })
})

describe("savingsGoalPercentOfPaycheck", () => {
  it("returns null when paycheck is missing or non-positive", () => {
    expect(savingsGoalPercentOfPaycheck(500, 0)).toBeNull()
    expect(savingsGoalPercentOfPaycheck(500, -100)).toBeNull()
  })

  it("expresses monthly goal as percent of one paycheck", () => {
    expect(savingsGoalPercentOfPaycheck(6000, 6000)).toBe(100)
    expect(savingsGoalPercentOfPaycheck(3000, 6000)).toBe(50)
    expect(savingsGoalPercentOfPaycheck(6000, 3000)).toBe(200)
  })
})

describe("snapOnboardingAllocationToStep", () => {
  it("uses midpoints step*i + step/2 (e.g. 25, 75) for nearest-50 buckets", () => {
    expect(snapOnboardingAllocationToStep(24, 1000)).toBe(0)
    expect(snapOnboardingAllocationToStep(25, 1000)).toBe(50)
    expect(snapOnboardingAllocationToStep(74, 1000)).toBe(50)
    expect(snapOnboardingAllocationToStep(75, 1000)).toBe(100)
  })

  it("snaps to nearest 50 within max", () => {
    expect(snapOnboardingAllocationToStep(73, 1000)).toBe(50)
    expect(snapOnboardingAllocationToStep(88, 1000)).toBe(100)
  })

  it("clamps to max after snapping when nearest step exceeds max", () => {
    expect(snapOnboardingAllocationToStep(997, 997)).toBe(997)
    // 996 → round to 1000, then min(1000, 997) = 997
    expect(snapOnboardingAllocationToStep(996, 997)).toBe(997)
  })

  it("returns 0 for non-positive max", () => {
    expect(snapOnboardingAllocationToStep(50, 0)).toBe(0)
  })
})
