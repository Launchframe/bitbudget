import { describe, expect, it } from "vitest"
import {
  resolveEffectiveTier,
  PREMIUM_TRIAL_RECEIPT_SMS_MONTHLY_CAP,
  refereeTrialMonthsForReferrerSubscription,
  refereePremiumExperienceCarrot,
  REFEREE_PREMIUM_CARROT_FALLBACK,
} from "@/lib/subscription"

describe("resolveEffectiveTier", () => {
  const t = (iso: string) => new Date(iso)

  it("returns premium when subscriptionTier is premium", () => {
    expect(
      resolveEffectiveTier(
        {
          subscriptionTier: "premium",
          premiumGratisUntil: null,
          premiumTrialUntil: null,
        },
        t("2026-06-01T12:00:00.000Z"),
      ),
    ).toBe("premium")
  })

  it("returns premium when gratis window active even if tier free", () => {
    expect(
      resolveEffectiveTier(
        {
          subscriptionTier: "free",
          premiumGratisUntil: t("2026-12-01T00:00:00.000Z"),
          premiumTrialUntil: null,
        },
        t("2026-06-01T12:00:00.000Z"),
      ),
    ).toBe("premium")
  })

  it("returns premium-trial when trial active and not gratis/paid", () => {
    expect(
      resolveEffectiveTier(
        {
          subscriptionTier: "free",
          premiumGratisUntil: null,
          premiumTrialUntil: t("2026-08-01T00:00:00.000Z"),
        },
        t("2026-06-01T12:00:00.000Z"),
      ),
    ).toBe("premium-trial")
  })

  it("paid premium wins over expired trial", () => {
    expect(
      resolveEffectiveTier(
        {
          subscriptionTier: "premium",
          premiumGratisUntil: null,
          premiumTrialUntil: t("2026-01-01T00:00:00.000Z"),
        },
        t("2026-06-01T12:00:00.000Z"),
      ),
    ).toBe("premium")
  })

  it("returns free when nothing active", () => {
    expect(
      resolveEffectiveTier(
        {
          subscriptionTier: "free",
          premiumGratisUntil: t("2026-01-01T00:00:00.000Z"),
          premiumTrialUntil: t("2026-02-01T00:00:00.000Z"),
        },
        t("2026-06-01T12:00:00.000Z"),
      ),
    ).toBe("free")
  })
})

describe("PREMIUM_TRIAL_RECEIPT_SMS_MONTHLY_CAP", () => {
  it("is 100", () => {
    expect(PREMIUM_TRIAL_RECEIPT_SMS_MONTHLY_CAP).toBe(100)
  })
})

describe("refereeTrialMonthsForReferrerSubscription", () => {
  it("returns 3 months only for paid premium billing tier", () => {
    expect(refereeTrialMonthsForReferrerSubscription("premium")).toBe(3)
    expect(refereeTrialMonthsForReferrerSubscription("free")).toBe(1)
  })
})

describe("refereePremiumExperienceCarrot", () => {
  it("includes only the applicable month count (1 vs 3), never both", () => {
    expect(refereePremiumExperienceCarrot(1)).toContain("1 month")
    expect(refereePremiumExperienceCarrot(1)).not.toContain("3 months")
    expect(refereePremiumExperienceCarrot(3)).toContain("3 months")
    expect(refereePremiumExperienceCarrot(3)).not.toContain("1 month")
    expect(REFEREE_PREMIUM_CARROT_FALLBACK).not.toMatch(/\b1 or 3\b/)
  })
})
