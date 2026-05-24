import { describe, expect, it } from "vitest"
import {
  isUnboundedOnboardingAllocation,
  onboardingAllocationCapForRow,
  onboardingSliderMaxForRow,
  ONBOARDING_UNBOUNDED_ALLOC_MAX,
  savingsGoalPercentOfPaycheck,
  snapOnboardingAllocationToStep,
} from "../onboarding-allocate-budget"

describe("onboarding allocation caps", () => {
  it("treats zero monthly budget as unbounded", () => {
    expect(isUnboundedOnboardingAllocation(0)).toBe(true)
    expect(onboardingSliderMaxForRow(0, 0, 0)).toBe(ONBOARDING_UNBOUNDED_ALLOC_MAX)
    expect(onboardingAllocationCapForRow(0, 5000)).toBe(ONBOARDING_UNBOUNDED_ALLOC_MAX)
  })

  it("uses remaining pool when monthly budget is set", () => {
    expect(isUnboundedOnboardingAllocation(2400)).toBe(false)
    expect(onboardingSliderMaxForRow(600, 1800, 2400)).toBe(2400)
    expect(onboardingAllocationCapForRow(2400, 600)).toBe(1800)
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
