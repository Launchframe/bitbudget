import { describe, expect, it } from "vitest"
import {
  isOnboardingDraftBudgetEnvelope,
  isOnboardingVisibleServerEnvelope,
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

  it("excludes archived and soft-deleted server rows from onboarding merge", () => {
    expect(isOnboardingVisibleServerEnvelope({ name: "Rent" })).toBe(true)
    expect(isOnboardingVisibleServerEnvelope({ name: "Rent", archived: true })).toBe(false)
    expect(
      isOnboardingVisibleServerEnvelope({
        name: "Rent",
        deletedAt: "2026-05-01T00:00:00.000Z",
      }),
    ).toBe(false)
    expect(
      isOnboardingVisibleServerEnvelope({
        name: "Savings",
        systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
      }),
    ).toBe(false)
  })
})
