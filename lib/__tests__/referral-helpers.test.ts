import { describe, expect, it } from "vitest"
import {
  addMonthsUtc,
  generateUserReferralCodeSegment,
  isValidOfferSlug,
  normalizeOfferSlug,
  normalizeReferralCodeInput,
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
})
