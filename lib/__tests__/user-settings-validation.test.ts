import { describe, expect, it } from "vitest"
import {
  booleanSettingsFieldError,
  monthlyIncomeError,
  setupGuideSnoozedUntilError,
} from "@/lib/user-settings-validation"

describe("booleanSettingsFieldError", () => {
  it("returns null when boolean fields are omitted or valid", () => {
    expect(booleanSettingsFieldError({})).toBeNull()
    expect(booleanSettingsFieldError({ walkthroughCompleted: true })).toBeNull()
    expect(booleanSettingsFieldError({ setupGuideDismissed: false })).toBeNull()
    expect(booleanSettingsFieldError({ setupGuideShowOnDashboard: true })).toBeNull()
    expect(
      booleanSettingsFieldError({
        onboardingComplete: false,
        opportunityCostEnabled: true,
      }),
    ).toBeNull()
  })

  it("rejects non-boolean walkthroughCompleted", () => {
    expect(booleanSettingsFieldError({ walkthroughCompleted: "true" })).toBe(
      "walkthroughCompleted must be a boolean",
    )
  })

  it("rejects non-boolean onboardingComplete and opportunityCostEnabled", () => {
    expect(booleanSettingsFieldError({ onboardingComplete: 1 })).toBe(
      "onboardingComplete must be a boolean",
    )
    expect(booleanSettingsFieldError({ opportunityCostEnabled: null })).toBe(
      "opportunityCostEnabled must be a boolean",
    )
  })
})

describe("monthlyIncomeError", () => {
  it("returns null when value is undefined (field not in request)", () => {
    expect(monthlyIncomeError(undefined)).toBeNull()
  })

  it("accepts zero (income not yet set)", () => {
    expect(monthlyIncomeError(0)).toBeNull()
  })

  it("accepts a typical positive monthly income", () => {
    expect(monthlyIncomeError(5000)).toBeNull()
    expect(monthlyIncomeError(0.01)).toBeNull()
  })

  it("rejects a negative income", () => {
    expect(monthlyIncomeError(-1)).toContain("non-negative")
  })

  it("rejects Infinity (would cascade to undefined sweep math)", () => {
    expect(monthlyIncomeError(Infinity)).toContain("non-negative finite")
    expect(monthlyIncomeError(-Infinity)).toContain("non-negative finite")
  })

  it("rejects NaN", () => {
    expect(monthlyIncomeError(NaN)).toContain("non-negative finite")
  })

  it("rejects non-number types that would bypass DB type coercion", () => {
    expect(monthlyIncomeError("5000")).toContain("non-negative finite")
    expect(monthlyIncomeError(null)).toContain("non-negative finite")
    expect(monthlyIncomeError(true)).toContain("non-negative finite")
  })
})

describe("setupGuideSnoozedUntilError", () => {
  it("accepts undefined and null", () => {
    expect(setupGuideSnoozedUntilError(undefined)).toBeNull()
    expect(setupGuideSnoozedUntilError(null)).toBeNull()
  })

  it("accepts valid ISO date-time strings", () => {
    expect(setupGuideSnoozedUntilError("2026-05-25T12:00:00.000Z")).toBeNull()
    expect(setupGuideSnoozedUntilError("2026-05-25T12:00:00Z")).toBeNull()
    expect(setupGuideSnoozedUntilError("2026-05-25T12:00:00+00:00")).toBeNull()
  })

  it("rejects non-string and invalid dates", () => {
    expect(setupGuideSnoozedUntilError(123)).toContain("ISO 8601")
    expect(setupGuideSnoozedUntilError("not-a-date")).toContain("ISO 8601")
  })

  it("rejects date-only strings that are not full ISO UTC", () => {
    expect(setupGuideSnoozedUntilError("2026-05-25")).toContain("ISO 8601")
  })
})
