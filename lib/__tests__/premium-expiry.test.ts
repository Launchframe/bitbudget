import { describe, expect, it } from "vitest"
import {
  PREMIUM_EXPIRY_GRACE_UTC_HOUR,
  PREMIUM_RENEWAL_REMINDER_DAYS,
  calendarDaysUntilExpiry,
  formatPremiumExpiryCalendarDate,
  isExpiredNotificationDay,
  isTimedPremiumAccessActive,
  premiumAccessEndsAt,
  premiumRenewalLogKey,
  reminderKindForDaysLeft,
  resolveActivePremiumExpiry,
  resolveRecentlyLapsedPremiumExpiry,
} from "@/lib/premium-expiry"

describe("premiumAccessEndsAt", () => {
  it("extends access until 04:00 UTC the day after calendar expiry", () => {
    const expiry = new Date("2026-06-15T18:30:00.000Z")
    const ends = premiumAccessEndsAt(expiry)
    expect(ends.toISOString()).toBe("2026-06-16T04:00:00.000Z")
    expect(PREMIUM_EXPIRY_GRACE_UTC_HOUR).toBe(4)
  })

  it("keeps access active through the expiry calendar date", () => {
    const expiry = new Date("2026-06-15T12:00:00.000Z")
    expect(isTimedPremiumAccessActive(expiry, new Date("2026-06-15T23:59:59.000Z"))).toBe(true)
    expect(isTimedPremiumAccessActive(expiry, new Date("2026-06-16T03:59:59.000Z"))).toBe(true)
    expect(isTimedPremiumAccessActive(expiry, new Date("2026-06-16T04:00:00.000Z"))).toBe(false)
  })
})

describe("calendarDaysUntilExpiry", () => {
  it("counts whole UTC days until expiry date", () => {
    const expiry = new Date("2026-06-15T00:00:00.000Z")
    expect(calendarDaysUntilExpiry(expiry, new Date("2026-06-01T12:00:00.000Z"))).toBe(14)
    expect(calendarDaysUntilExpiry(expiry, new Date("2026-06-14T12:00:00.000Z"))).toBe(1)
    expect(calendarDaysUntilExpiry(expiry, new Date("2026-06-15T12:00:00.000Z"))).toBe(0)
  })
})

describe("reminderKindForDaysLeft", () => {
  it("matches configured reminder windows only", () => {
    for (const d of PREMIUM_RENEWAL_REMINDER_DAYS) {
      expect(reminderKindForDaysLeft(d)).toBe(d)
    }
    expect(reminderKindForDaysLeft(7)).toBeNull()
    expect(reminderKindForDaysLeft(0)).toBeNull()
  })
})

describe("isExpiredNotificationDay", () => {
  it("is true only after grace ends on the UTC day after calendar expiry", () => {
    const expiry = new Date("2026-06-15T00:00:00.000Z")
    expect(isExpiredNotificationDay(expiry, new Date("2026-06-15T12:00:00.000Z"))).toBe(false)
    expect(isExpiredNotificationDay(expiry, new Date("2026-06-16T03:59:59.000Z"))).toBe(false)
    expect(isExpiredNotificationDay(expiry, new Date("2026-06-16T04:00:00.000Z"))).toBe(true)
    expect(isExpiredNotificationDay(expiry, new Date("2026-06-17T09:00:00.000Z"))).toBe(false)
  })
})

describe("premiumRenewalLogKey", () => {
  it("dedupes by source, calendar expiry, and kind", () => {
    const expiry = new Date("2026-06-15T18:00:00.000Z")
    expect(premiumRenewalLogKey("trial", expiry, 14)).toBe("trial:2026-06-15:14")
    expect(formatPremiumExpiryCalendarDate(expiry)).toBe("2026-06-15")
  })
})

describe("resolveActivePremiumExpiry", () => {
  const now = new Date("2026-06-01T12:00:00.000Z")

  it("prefers soonest active expiry among sources", () => {
    const active = resolveActivePremiumExpiry(
      {
        subscriptionTier: "free",
        premiumTrialUntil: new Date("2026-06-20T00:00:00.000Z"),
        premiumGratisUntil: new Date("2026-06-10T00:00:00.000Z"),
        premiumMembershipUntil: null,
      },
      now,
    )
    expect(active?.source).toBe("gratis")
    expect(active?.population).toBe("membership")
  })

  it("returns trial population for trial source", () => {
    const active = resolveActivePremiumExpiry(
      {
        subscriptionTier: "free",
        premiumTrialUntil: new Date("2026-06-20T00:00:00.000Z"),
        premiumGratisUntil: null,
        premiumMembershipUntil: null,
      },
      now,
    )
    expect(active?.source).toBe("trial")
    expect(active?.population).toBe("trial")
  })

  it("ignores stale trial when subscriptionTier is premium", () => {
    const active = resolveActivePremiumExpiry(
      {
        subscriptionTier: "premium",
        premiumTrialUntil: new Date("2026-06-20T00:00:00.000Z"),
        premiumGratisUntil: null,
        premiumMembershipUntil: null,
      },
      now,
    )
    expect(active).toBeNull()
  })
})

describe("resolveRecentlyLapsedPremiumExpiry", () => {
  it("returns most recently lapsed source after grace ends", () => {
    const lapsed = resolveRecentlyLapsedPremiumExpiry(
      {
        subscriptionTier: "free",
        premiumTrialUntil: new Date("2026-06-14T00:00:00.000Z"),
        premiumGratisUntil: null,
        premiumMembershipUntil: null,
      },
      new Date("2026-06-16T09:00:00.000Z"),
    )
    expect(lapsed?.source).toBe("trial")
  })

  it("returns null while grace is still active", () => {
    const lapsed = resolveRecentlyLapsedPremiumExpiry(
      {
        subscriptionTier: "free",
        premiumTrialUntil: new Date("2026-06-15T00:00:00.000Z"),
        premiumGratisUntil: null,
        premiumMembershipUntil: null,
      },
      new Date("2026-06-16T03:00:00.000Z"),
    )
    expect(lapsed).toBeNull()
  })
})
