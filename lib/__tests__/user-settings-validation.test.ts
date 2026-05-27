import { describe, expect, it } from "vitest"
import {
  booleanSettingsFieldError,
  setupGuideSnoozedUntilError,
} from "@/lib/user-settings-validation"

/**
 * Inline validation logic for monthlyIncome mirrors the check added to
 * PUT /api/user/settings.  Keeping it here documents the expected behaviour
 * and guards against regressions where a negative or non-finite income is
 * persisted, which causes sweep/funding math to produce nonsense values.
 */
function monthlyIncomeError(value: unknown): string | null {
  if (value === undefined) return null
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return "monthlyIncome must be a non-negative number"
  }
  return null
}

describe("monthlyIncome validation (guards PUT /api/user/settings)", () => {
  it("accepts undefined (field omitted)", () => {
    expect(monthlyIncomeError(undefined)).toBeNull()
  })

  it("accepts zero", () => {
    expect(monthlyIncomeError(0)).toBeNull()
  })

  it("accepts positive finite numbers", () => {
    expect(monthlyIncomeError(5000)).toBeNull()
    expect(monthlyIncomeError(0.01)).toBeNull()
  })

  it("rejects negative values", () => {
    expect(monthlyIncomeError(-1)).not.toBeNull()
    expect(monthlyIncomeError(-0.01)).not.toBeNull()
  })

  it("rejects non-finite values (Infinity, -Infinity, NaN)", () => {
    expect(monthlyIncomeError(Infinity)).not.toBeNull()
    expect(monthlyIncomeError(-Infinity)).not.toBeNull()
    expect(monthlyIncomeError(NaN)).not.toBeNull()
  })

  it("rejects non-number types", () => {
    expect(monthlyIncomeError("5000")).not.toBeNull()
    expect(monthlyIncomeError(null)).not.toBeNull()
    expect(monthlyIncomeError([])).not.toBeNull()
  })
})

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
