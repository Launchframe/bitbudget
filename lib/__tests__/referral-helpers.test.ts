import { describe, expect, it } from "vitest"
import {
  addMonthsUtc,
  canRedeemReferralAsReferee,
  canRedeemReferralInSettings,
  generateUserReferralCodeSegment,
  isValidOfferSlug,
  normalizeOfferSlug,
  normalizeReferralCodeInput,
  refereePostOnboardingRedeemDeadline,
  REFEREE_POST_ONBOARDING_REDEEM_DAYS,
} from "@/lib/referral"

describe("referral code helpers", () => {
  it("normalizes user code to uppercase", () => {
    expect(normalizeReferralCodeInput("  ab12cd34  ")).toBe("AB12CD34")
  })

  it("normalizes offer slug to lowercase", () => {
    expect(normalizeOfferSlug("  Podcast-50 ")).toBe("podcast-50")
  })

  it("validates offer slugs", () => {
    expect(isValidOfferSlug("podcast-50")).toBe(true)
    expect(isValidOfferSlug("ab")).toBe(true)
    expect(isValidOfferSlug("")).toBe(false)
    expect(isValidOfferSlug("-bad")).toBe(false)
    expect(isValidOfferSlug("bad-")).toBe(false)
  })

  it("generates fixed-length alphanumeric segments", () => {
    const a = generateUserReferralCodeSegment()
    const b = generateUserReferralCodeSegment()
    expect(a).toHaveLength(8)
    expect(b).toHaveLength(8)
    expect(a).toMatch(/^[A-Z0-9]+$/)
    expect(b).toMatch(/^[A-Z0-9]+$/)
  })

  it("addMonthsUtc rolls month correctly", () => {
    const start = new Date(Date.UTC(2026, 0, 15, 12, 0, 0))
    const end = addMonthsUtc(start, 3)
    expect(end.getUTCMonth()).toBe(3)
    expect(end.getUTCDate()).toBe(15)
  })

  it("refereePostOnboardingRedeemDeadline adds configured days", () => {
    const completed = new Date(Date.UTC(2026, 4, 1, 12, 0, 0))
    const deadline = refereePostOnboardingRedeemDeadline(completed)
    expect(deadline?.getTime()).toBe(
      completed.getTime() + REFEREE_POST_ONBOARDING_REDEEM_DAYS * 86400000,
    )
  })

  it("canRedeemReferralAsReferee allows onboarding and post-onboarding window", () => {
    const completed = new Date(Date.UTC(2026, 4, 1, 12, 0, 0))
    expect(
      canRedeemReferralAsReferee({
        onboardingComplete: false,
        onboardingCompletedAt: null,
        alreadyRedeemed: false,
        now: completed,
      }),
    ).toBe(true)
    expect(
      canRedeemReferralAsReferee({
        onboardingComplete: true,
        onboardingCompletedAt: completed,
        alreadyRedeemed: false,
        now: new Date(completed.getTime() + 6 * 86400000),
      }),
    ).toBe(true)
    expect(
      canRedeemReferralAsReferee({
        onboardingComplete: true,
        onboardingCompletedAt: completed,
        alreadyRedeemed: false,
        now: new Date(completed.getTime() + 7 * 86400000),
      }),
    ).toBe(false)
    expect(
      canRedeemReferralAsReferee({
        onboardingComplete: true,
        onboardingCompletedAt: completed,
        alreadyRedeemed: true,
        now: completed,
      }),
    ).toBe(false)
    expect(
      canRedeemReferralAsReferee({
        onboardingComplete: true,
        onboardingCompletedAt: null,
        alreadyRedeemed: false,
        now: new Date(),
      }),
    ).toBe(false)
  })

  it("canRedeemReferralInSettings requires finished onboarding", () => {
    const completed = new Date(Date.UTC(2026, 4, 1, 12, 0, 0))
    expect(
      canRedeemReferralInSettings({
        onboardingComplete: false,
        onboardingCompletedAt: null,
        alreadyRedeemed: false,
        now: completed,
      }),
    ).toBe(false)
    expect(
      canRedeemReferralInSettings({
        onboardingComplete: true,
        onboardingCompletedAt: completed,
        alreadyRedeemed: false,
        now: new Date(completed.getTime() + 6 * 86400000),
      }),
    ).toBe(true)
  })
})
