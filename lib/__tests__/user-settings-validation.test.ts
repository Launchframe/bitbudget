import { describe, expect, it } from "vitest"
import {
  booleanSettingsFieldError,
  setupGuideSnoozedUntilError,
} from "@/lib/user-settings-validation"
import { validateDecimal12_2 } from "@/lib/decimal-validation"

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

describe("monthlyIncome validation via validateDecimal12_2 (PUT /api/user/settings regression)", () => {
  it("accepts valid non-negative monthly income values", () => {
    expect(validateDecimal12_2(0, "monthlyIncome").ok).toBe(true)
    expect(validateDecimal12_2(5000, "monthlyIncome").ok).toBe(true)
    expect(validateDecimal12_2(1234.56, "monthlyIncome").ok).toBe(true)
  })

  it("rejects negative monthly income — would corrupt sweep calculations", () => {
    expect(validateDecimal12_2(-1, "monthlyIncome").ok).toBe(false)
    expect(validateDecimal12_2(-0.01, "monthlyIncome").ok).toBe(false)
  })

  it("rejects non-finite values (Infinity, NaN) for monthly income", () => {
    expect(validateDecimal12_2(Infinity, "monthlyIncome").ok).toBe(false)
    expect(validateDecimal12_2(-Infinity, "monthlyIncome").ok).toBe(false)
    expect(validateDecimal12_2(NaN, "monthlyIncome").ok).toBe(false)
  })

  it("rounds monthlyIncome to 2 decimal places before persisting", () => {
    const result = validateDecimal12_2(1000.999, "monthlyIncome")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(1001)
  })
})
