// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    referral: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    referralCode: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/notify", () => ({
  notifyReferralActivated: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from "@/lib/db"
import {
  redeemReferralCode,
  REFEREE_POST_ONBOARDING_REDEEM_DAYS,
} from "@/lib/referral"

const referralFindUnique = vi.mocked(prisma.referral.findUnique)
const userFindUnique = vi.mocked(prisma.user.findUnique)
const codeFindUnique = vi.mocked(prisma.referralCode.findUnique)
const transaction = vi.mocked(prisma.$transaction)

function mockValidReferralCode(referrerId = "referrer1") {
  codeFindUnique.mockResolvedValue({
    id: "code1",
    code: "TESTCODE",
    active: true,
    startsAt: new Date(Date.UTC(2020, 0, 1)),
    expiresAt: new Date(Date.UTC(2030, 0, 1)),
    usedCount: 0,
    maxUses: 100,
    type: "user",
    label: null,
    ownerId: referrerId,
    owner: { name: "Referrer" },
  } as never)
}

function mockSuccessfulRedeemTransaction() {
  transaction.mockImplementation(async (fn) => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      referral: { create: vi.fn().mockResolvedValue({}) },
      user: {
        findUnique: vi.fn().mockResolvedValue({ opportunityCostEnabled: false }),
        update: vi.fn().mockResolvedValue({}),
      },
    }
    return fn(tx as never)
  })
}

describe("redeemReferralCode post-onboarding window", () => {
  beforeEach(() => {
    referralFindUnique.mockResolvedValue(null)
    transaction.mockReset()
  })

  it("allows redeem while onboarding is incomplete", async () => {
    mockValidReferralCode()
    userFindUnique.mockResolvedValue({
      onboardingComplete: false,
      onboardingCompletedAt: null,
    } as never)
    mockSuccessfulRedeemTransaction()

    const result = await redeemReferralCode({
      refereeId: "referee1",
      rawCode: "TESTCODE",
      now: new Date(Date.UTC(2026, 4, 10, 12, 0, 0)),
    })

    expect(result.ok).toBe(true)
    expect(transaction).toHaveBeenCalled()
  })

  it("allows redeem within 7 days after onboarding completes", async () => {
    mockValidReferralCode()
    const completed = new Date(Date.UTC(2026, 4, 1, 12, 0, 0))
    userFindUnique.mockResolvedValue({
      onboardingComplete: true,
      onboardingCompletedAt: completed,
    } as never)
    mockSuccessfulRedeemTransaction()

    const result = await redeemReferralCode({
      refereeId: "referee1",
      rawCode: "TESTCODE",
      now: new Date(completed.getTime() + 6 * 86400000),
    })

    expect(result.ok).toBe(true)
    expect(transaction).toHaveBeenCalled()
  })

  it("returns redeem_window_closed at exactly 7 days after onboarding completes", async () => {
    mockValidReferralCode()
    const completed = new Date(Date.UTC(2026, 4, 1, 12, 0, 0))
    userFindUnique.mockResolvedValue({
      onboardingComplete: true,
      onboardingCompletedAt: completed,
    } as never)

    const result = await redeemReferralCode({
      refereeId: "referee1",
      rawCode: "TESTCODE",
      now: new Date(completed.getTime() + REFEREE_POST_ONBOARDING_REDEEM_DAYS * 86400000),
    })

    expect(result).toEqual({
      ok: false,
      status: 410,
      code: "redeem_window_closed",
      message: "Referral codes can only be applied within 7 days of finishing onboarding",
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it("returns redeem_window_closed after the 7-day deadline", async () => {
    mockValidReferralCode()
    const completed = new Date(Date.UTC(2026, 4, 1, 12, 0, 0))
    userFindUnique.mockResolvedValue({
      onboardingComplete: true,
      onboardingCompletedAt: completed,
    } as never)

    const result = await redeemReferralCode({
      refereeId: "referee1",
      rawCode: "TESTCODE",
      now: new Date(completed.getTime() + 8 * 86400000),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("redeem_window_closed")
      expect(result.status).toBe(410)
    }
    expect(transaction).not.toHaveBeenCalled()
  })
})
