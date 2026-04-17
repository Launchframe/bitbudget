import { prisma } from "../lib/db"
import {
  E2E_EXHAUSTED_CODE,
  E2E_OFFER_SLUG,
  E2E_REFERRER_FREE_EMAIL,
  E2E_REFERRER_PREMIUM_EMAIL,
  E2E_USER_CODE_FREE_REFERRER,
  E2E_USER_CODE_PREMIUM_REFERRER,
} from "./fixtures/referral-e2e-constants"

const CODE_STRINGS = [
  E2E_USER_CODE_PREMIUM_REFERRER,
  E2E_USER_CODE_FREE_REFERRER,
  E2E_OFFER_SLUG,
  E2E_EXHAUSTED_CODE,
] as const

/**
 * Remove prior e2e users/codes/referrals so seeds are idempotent.
 * Deleting seeded ReferralCodes cascades Referral rows; then drop all @bitbudget.test e2e-* users.
 */
export async function resetReferralE2eData(): Promise<void> {
  await prisma.referralCode.deleteMany({
    where: { code: { in: [...CODE_STRINGS] } },
  })
  await prisma.user.deleteMany({
    where: {
      AND: [{ email: { startsWith: "e2e-" } }, { email: { endsWith: "@bitbudget.test" } }],
    },
  })
}

/**
 * Two referrers (premium + free), user codes, one offer slug, one exhausted code.
 */
export async function seedReferralE2eData(): Promise<void> {
  const now = new Date()
  /** One day before `now` so `startsAt <= now` always holds for redeem (matches validate). */
  const startsAt = new Date(now.getTime() - 86400000)
  const expiresAt = new Date(now.getTime() + 30 * 86400000)

  const premiumReferrer = await prisma.user.create({
    data: {
      email: E2E_REFERRER_PREMIUM_EMAIL,
      name: "E2E Premium Referrer",
      subscriptionTier: "premium",
      onboardingComplete: true,
      opportunityCostEnabled: true,
    },
  })

  const freeReferrer = await prisma.user.create({
    data: {
      email: E2E_REFERRER_FREE_EMAIL,
      name: "E2E Free Referrer",
      subscriptionTier: "free",
      onboardingComplete: true,
      opportunityCostEnabled: false,
    },
  })

  await prisma.referralCode.createMany({
    data: [
      {
        code: E2E_USER_CODE_PREMIUM_REFERRER,
        type: "user",
        ownerId: premiumReferrer.id,
        maxUses: 50,
        usedCount: 0,
        startsAt,
        expiresAt,
        active: true,
      },
      {
        code: E2E_USER_CODE_FREE_REFERRER,
        type: "user",
        ownerId: freeReferrer.id,
        maxUses: 50,
        usedCount: 0,
        startsAt,
        expiresAt,
        active: true,
      },
      {
        code: E2E_OFFER_SLUG,
        type: "offer",
        ownerId: premiumReferrer.id,
        label: "E2E Offer",
        maxUses: 50,
        usedCount: 0,
        startsAt,
        expiresAt,
        active: true,
      },
      {
        code: E2E_EXHAUSTED_CODE,
        type: "user",
        ownerId: freeReferrer.id,
        maxUses: 1,
        usedCount: 1,
        startsAt,
        expiresAt,
        active: true,
      },
    ],
  })
}

export async function seedReferralE2e(): Promise<void> {
  await resetReferralE2eData()
  await seedReferralE2eData()
}
