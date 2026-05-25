import { describe, expect, it } from "vitest"
import { booleanSettingsFieldError } from "@/lib/user-settings-validation"

describe("booleanSettingsFieldError", () => {
  it("returns null when boolean fields are omitted or valid", () => {
    expect(booleanSettingsFieldError({})).toBeNull()
    expect(booleanSettingsFieldError({ walkthroughCompleted: true })).toBeNull()
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
