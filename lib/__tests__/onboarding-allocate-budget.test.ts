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
  bumpUnboundedOnboardingSliderVisitedMax,
  unboundedOnboardingSliderMaxForGestureWithVisited,
  unboundedOnboardingSliderVisitedMax,
  defaultOnboardingSavingsGoalAmount,
  onboardingSavingsGoalAmountFromPercent,
  onboardingSavingsGoalCapacity,
  onboardingSavingsGoalPercentOfCapacity,
  scaleOnboardingAllocationsToBudget,
  unboundedOnboardingSliderThumbPct,
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

  it("uses envelope totals for savings goal capacity when unbounded", () => {
    expect(onboardingSavingsGoalCapacity(0, 12_000)).toBe(12_000)
    expect(onboardingSavingsGoalCapacity(3_000, 12_000)).toBe(3_000)
  })
})

describe("onboarding savings goal defaults", () => {
  it("defaults to 10% of capacity snapped to $25", () => {
    expect(defaultOnboardingSavingsGoalAmount(12_000)).toBe(1_200)
    expect(defaultOnboardingSavingsGoalAmount(10_050)).toBe(1_000)
  })

  it("derives amount and percent from capacity", () => {
    expect(onboardingSavingsGoalAmountFromPercent(12_000, 10)).toBe(1_200)
    expect(onboardingSavingsGoalPercentOfCapacity(1_200, 12_000)).toBe(10)
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

describe("unboundedOnboardingSliderVisitedMax", () => {
  it("defaults to the floor or allotment, whichever is larger", () => {
    expect(unboundedOnboardingSliderVisitedMax(undefined, 0)).toBe(1_000)
    expect(unboundedOnboardingSliderVisitedMax(undefined, 1_200)).toBe(1_200)
  })

  it("never shrinks below a previously visited max", () => {
    expect(unboundedOnboardingSliderVisitedMax(2_000, 800)).toBe(2_000)
    expect(unboundedOnboardingSliderVisitedMax(2_000, 1_200)).toBe(2_000)
  })

  it("grows when the candidate exceeds the current visited max", () => {
    expect(bumpUnboundedOnboardingSliderVisitedMax(2_000, 4_000)).toBe(4_000)
    expect(bumpUnboundedOnboardingSliderVisitedMax(undefined, 2_000)).toBe(2_000)
  })

  it("uses visited max for gesture headroom without shrinking", () => {
    expect(unboundedOnboardingSliderMaxForGestureWithVisited(800, 2_000)).toBe(2_000)
    expect(unboundedOnboardingSliderMaxForGestureWithVisited(1_200, 2_000)).toBe(2_000)
    expect(unboundedOnboardingSliderMaxForGestureWithVisited(1_200, undefined)).toBe(2_000)
  })
})

describe("scaleOnboardingAllocationsToBudget", () => {
  it("preserves proportional shares when scaling down to a bounded budget", () => {
    expect(scaleOnboardingAllocationsToBudget([5_000, 2_000, 3_000], 3_000)).toEqual([
      1_500,
      600,
      900,
    ])
  })

  it("leaves allotments unchanged when already within budget", () => {
    expect(scaleOnboardingAllocationsToBudget([500, 300, 200], 3_000)).toEqual([500, 300, 200])
  })

  it("does not scale when budget is unbounded", () => {
    expect(scaleOnboardingAllocationsToBudget([5_000, 2_000, 3_000], 0)).toEqual([
      5_000,
      2_000,
      3_000,
    ])
  })
})

describe("unboundedOnboardingSliderThumbPct", () => {
  it("keeps the thumb at the right edge when pinned after a band expands", () => {
    expect(unboundedOnboardingSliderThumbPct(1_000, 2_000, new Set([1_000]))).toBe(100)
  })

  it("uses proportional position between expanded bands", () => {
    expect(unboundedOnboardingSliderThumbPct(1_500, 2_000, new Set([1_000]))).toBe(75)
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
