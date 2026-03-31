import { describe, expect, it } from "vitest"
import {
  resolveEffectiveTier,
  PREMIUM_TRIAL_RECEIPT_SMS_MONTHLY_CAP,
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
