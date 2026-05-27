import { prisma } from "../lib/db"
import {
  E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON,
  E2E_TEST_PRIVACY_KEY_SALT_HEX,
} from "./fixtures/encryption-e2e-constants"
import {
  E2E_APP_ENVELOPE_A,
  E2E_APP_ENVELOPE_B,
  E2E_APP_TAG,
  E2E_APP_USER_EMAIL,
  E2E_PREMIUM_USER_EMAIL,
} from "./fixtures/app-e2e-constants"

export async function resetAppE2eUsers(): Promise<void> {
  await prisma.user.deleteMany({
    where: {
      email: { in: [E2E_APP_USER_EMAIL, E2E_PREMIUM_USER_EMAIL] },
    },
  })
}

export async function seedAppE2eUser(): Promise<{ userId: string; envelopeAId: string; envelopeBId: string }> {
  const user = await prisma.user.create({
    data: {
      email: E2E_APP_USER_EMAIL,
      name: "E2E App User",
      onboardingComplete: true,
      monthlyIncome: 5000,
      payCadence: "monthly",
      opportunityCostEnabled: false,
      savingsExperience: "engaged",
      encryptedPrivacyKey: E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON,
      privacyKeySalt: E2E_TEST_PRIVACY_KEY_SALT_HEX,
    },
  })

  const envelopeA = await prisma.envelope.create({
    data: {
      userId: user.id,
      name: E2E_APP_ENVELOPE_A,
      monthlyAllotment: 400,
      color: "#10B981",
    },
  })

  const envelopeB = await prisma.envelope.create({
    data: {
      userId: user.id,
      name: E2E_APP_ENVELOPE_B,
      monthlyAllotment: 200,
      color: "#3B82F6",
    },
  })

  await prisma.tag.create({
    data: { userId: user.id, name: E2E_APP_TAG },
  })

  const today = new Date()
  today.setUTCHours(12, 0, 0, 0)
  const lastMonth = new Date(today)
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1)

  await prisma.transaction.createMany({
    data: [
      {
        userId: user.id,
        envelopeId: envelopeA.id,
        payee: "E2E Grocery Run",
        amount: 42.5,
        type: "expense",
        date: today,
        tags: `["${E2E_APP_TAG}"]`,
      },
      {
        userId: user.id,
        envelopeId: envelopeB.id,
        payee: "E2E Bus Fare",
        amount: 12,
        type: "expense",
        date: lastMonth,
        tags: "[]",
      },
      {
        userId: user.id,
        envelopeId: envelopeA.id,
        payee: "E2E Paycheck",
        amount: 2500,
        type: "credit",
        date: today,
        tags: "[]",
      },
    ],
  })

  return { userId: user.id, envelopeAId: envelopeA.id, envelopeBId: envelopeB.id }
}

export async function seedPremiumE2eUser(): Promise<{ userId: string }> {
  const user = await prisma.user.create({
    data: {
      email: E2E_PREMIUM_USER_EMAIL,
      name: "E2E Premium User",
      onboardingComplete: true,
      monthlyIncome: 8000,
      opportunityCostEnabled: true,
      subscriptionTier: "premium",
      premiumTrialUntil: new Date(Date.now() + 90 * 86400000),
      encryptedPrivacyKey: E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON,
      privacyKeySalt: E2E_TEST_PRIVACY_KEY_SALT_HEX,
    },
  })

  const premiumEnvelope = await prisma.envelope.create({
    data: {
      userId: user.id,
      name: "E2E Premium Spend",
      monthlyAllotment: 500,
      color: "#F7931A",
    },
  })

  const d = new Date()
  for (let i = 0; i < 3; i++) {
    const dt = new Date(d)
    dt.setUTCMonth(dt.getUTCMonth() - i)
    await prisma.transaction.create({
      data: {
        userId: user.id,
        envelopeId: premiumEnvelope.id,
        payee: `E2E Analytics Spend ${i}`,
        amount: 50 + i,
        type: "expense",
        date: dt,
        tags: "[]",
      },
    })
  }

  return { userId: user.id }
}

export async function seedAppE2e(): Promise<void> {
  await resetAppE2eUsers()
  await seedAppE2eUser()
  await seedPremiumE2eUser()
}
