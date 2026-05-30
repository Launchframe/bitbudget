// @vitest-environment node
/**
 * Regression test: PUT /api/user/settings must reject invalid monthlyIncome values.
 *
 * Root cause: monthlyIncome was missing a validation block in the PUT handler,
 * so negative, non-finite, or oversized values were written directly to the DB.
 * A negative monthlyIncome causes the envelope-funding cron to credit 0 income
 * (grossIncomeForFundingRun guards against ≤0) — silently breaking the user's
 * pay-yourself-first flow until they correct the value.
 */
import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { userUpdate, userFindUnique } = vi.hoisted(() => ({
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      update: userUpdate,
      findUnique: userFindUnique,
    },
    referral: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user_test" } }),
}))

vi.mock("@/lib/referral", () => ({
  canRedeemReferralInSettings: vi.fn().mockReturnValue(false),
  referralStatsForUser: vi.fn().mockResolvedValue({
    activeCode: null,
    lastCode: null,
    referralCount: 0,
    activatedCount: 0,
    premiumGratisUntil: null,
    premiumTrialUntil: null,
  }),
}))

vi.mock("@/lib/subscription", () => ({
  refereeTrialMonthsForReferrerSubscription: vi.fn().mockReturnValue(1),
  resolveEffectiveTier: vi.fn().mockReturnValue("free"),
}))

vi.mock("@/lib/pay-cadence-server", () => ({
  assertPayCadencePersistable: vi.fn(),
  isDailyPayCadenceAllowed: vi.fn().mockReturnValue(false),
}))

import { PUT } from "@/app/api/user/settings/route"

function makePutRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/user/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PUT /api/user/settings – monthlyIncome validation", () => {
  it("rejects a negative monthlyIncome with 400", async () => {
    const res = await PUT(makePutRequest({ monthlyIncome: -100 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/non-negative|monthlyIncome/i)
  })

  it("rejects a very large monthlyIncome that exceeds Decimal(12,2) with 400", async () => {
    const res = await PUT(makePutRequest({ monthlyIncome: 1e15 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/exceed|monthlyIncome/i)
  })

  it("rejects a non-number monthlyIncome with 400", async () => {
    const res = await PUT(makePutRequest({ monthlyIncome: "not-a-number" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/finite|monthlyIncome/i)
  })

  it("accepts a valid monthlyIncome and persists it rounded to cents", async () => {
    userUpdate.mockResolvedValueOnce({
      monthlyIncome: 3000,
      payCadence: "monthly",
      payDays: [],
      payDayOfWeek: null,
      lastPaydayAt: null,
      estimatedAnnualIncome: null,
      sweepDefaultPolicy: "reset",
      sweepDefaultCapMultiplier: null,
      savingsExperience: "engaged",
      onboardingComplete: true,
      walkthroughCompleted: false,
      setupGuideSnoozedUntil: null,
      setupGuideDismissed: false,
      setupGuideShowOnDashboard: true,
      btcDisplayUnit: "btc",
      opportunityCostEnabled: false,
      receiptInboxToken: null,
      name: null,
      nostrDmEnabled: false,
      emailFeatureUpdates: false,
      emailFeedbackRequests: false,
      emailRecurringReminders: false,
      emailRenewalReminders: false,
      emailImportAlerts: false,
    } as never)

    const res = await PUT(makePutRequest({ monthlyIncome: 3000.567 }))
    expect(res.status).toBe(200)
    // Stored value must be rounded to 2 decimal places
    const updateArg = userUpdate.mock.calls[0]?.[0] as { data: { monthlyIncome: Prisma.Decimal } }
    expect(updateArg.data.monthlyIncome).toBeInstanceOf(Prisma.Decimal)
    expect(updateArg.data.monthlyIncome.toNumber()).toBe(3000.57)
  })
})
