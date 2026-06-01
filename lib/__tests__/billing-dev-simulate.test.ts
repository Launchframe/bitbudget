// @vitest-environment node
import { describe, expect, it } from "vitest"
import { computeDevPremiumTrialUntil, DEV_PREMIUM_SIMULATE_TRIAL_DAYS } from "../billing-dev-simulate"

describe("billing-dev-simulate", () => {
  it("computeDevPremiumTrialUntil adds days from now when no active trial", () => {
    const now = new Date(Date.UTC(2026, 5, 1, 12, 0, 0))
    const end = computeDevPremiumTrialUntil(null, now)
    const expected = new Date(now)
    expected.setUTCDate(expected.getUTCDate() + DEV_PREMIUM_SIMULATE_TRIAL_DAYS)
    expect(end.toISOString()).toBe(expected.toISOString())
  })

  it("computeDevPremiumTrialUntil extends from existing active trial end", () => {
    const now = new Date(Date.UTC(2026, 5, 1, 12, 0, 0))
    const existing = new Date(Date.UTC(2026, 5, 20, 12, 0, 0))
    const end = computeDevPremiumTrialUntil(existing, now)
    const expected = new Date(existing)
    expected.setUTCDate(expected.getUTCDate() + DEV_PREMIUM_SIMULATE_TRIAL_DAYS)
    expect(end.toISOString()).toBe(expected.toISOString())
  })
})
