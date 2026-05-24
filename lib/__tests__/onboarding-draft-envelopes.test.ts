import { describe, expect, it } from "vitest"
import {
  isOnboardingDraftBudgetEnvelope,
  withoutSystemSavingsEnvelope,
} from "@/lib/onboarding-draft-envelopes"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"

describe("onboarding-draft-envelopes", () => {
  it("excludes system Savings by role and reserved name", () => {
    expect(isOnboardingDraftBudgetEnvelope({ name: "Rent" })).toBe(true)
    expect(isOnboardingDraftBudgetEnvelope({ name: "Savings" })).toBe(false)
    expect(isOnboardingDraftBudgetEnvelope({ name: "savings" })).toBe(false)
    expect(
      isOnboardingDraftBudgetEnvelope({
        name: "Custom",
        systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
      }),
    ).toBe(false)
  })

  it("filters mixed lists", () => {
    expect(
      withoutSystemSavingsEnvelope([
        { name: "Rent" },
        { name: "Savings", systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS },
        { name: "Food" },
      ]),
    ).toEqual([{ name: "Rent" }, { name: "Food" }])
  })
})
