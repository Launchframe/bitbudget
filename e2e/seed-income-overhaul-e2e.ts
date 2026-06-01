import { prisma } from "../lib/db"
import { ensureSystemSavingsEnvelope } from "../lib/ensure-system-savings-envelope"
import {
  E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON,
  E2E_TEST_PRIVACY_KEY_SALT_HEX,
} from "./fixtures/encryption-e2e-constants"
import {
  E2E_INCOME_OVERHAUL_EMAIL,
  E2E_INCOME_OVERHAUL_ZERO_ALLOC_EMAIL,
  E2E_OVERHAUL_ENVELOPE_A,
  E2E_OVERHAUL_ENVELOPE_B,
  E2E_OVERHAUL_PUBLIC_KEY,
} from "./fixtures/income-overhaul-e2e-constants"

async function resetIncomeOverhaulUsers(): Promise<void> {
  await prisma.user.deleteMany({
    where: {
      email: { in: [E2E_INCOME_OVERHAUL_EMAIL, E2E_INCOME_OVERHAUL_ZERO_ALLOC_EMAIL] },
    },
  })
}

async function seedIncomeOverhaulUser(
  email: string,
  allotments: { a: number; b: number },
): Promise<{ userId: string; envelopeAId: string; envelopeBId: string }> {
  const user = await prisma.user.create({
    data: {
      email,
      name: email.includes("zero") ? "E2E Income Overhaul Zero Alloc" : "E2E Income Overhaul",
      onboardingComplete: true,
      walkthroughCompleted: true,
      monthlyIncome: 6000,
      payCadence: "bimonthly",
      payDays: [1, 15],
      payDayOfWeek: null,
      lastPaydayAt: null,
      opportunityCostEnabled: false,
      savingsExperience: "engaged",
      publicKey: E2E_OVERHAUL_PUBLIC_KEY,
      encryptedPrivacyKey: E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON,
      privacyKeySalt: E2E_TEST_PRIVACY_KEY_SALT_HEX,
    },
  })

  await ensureSystemSavingsEnvelope(user.id)

  const envelopeA = await prisma.envelope.create({
    data: {
      userId: user.id,
      name: E2E_OVERHAUL_ENVELOPE_A,
      monthlyAllotment: allotments.a,
      color: "#10B981",
    },
  })

  const envelopeB = await prisma.envelope.create({
    data: {
      userId: user.id,
      name: E2E_OVERHAUL_ENVELOPE_B,
      monthlyAllotment: allotments.b,
      color: "#3B82F6",
    },
  })

  return { userId: user.id, envelopeAId: envelopeA.id, envelopeBId: envelopeB.id }
}

export async function seedIncomeOverhaulE2e(): Promise<void> {
  await resetIncomeOverhaulUsers()
  await seedIncomeOverhaulUser(E2E_INCOME_OVERHAUL_EMAIL, { a: 400, b: 200 })
  await seedIncomeOverhaulUser(E2E_INCOME_OVERHAUL_ZERO_ALLOC_EMAIL, { a: 0, b: 0 })
}

/** Clear ledger rows between tests while keeping the seeded user. */
export async function resetIncomeOverhaulUserData(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) return
  await prisma.transaction.deleteMany({ where: { userId: user.id } })
  await prisma.envelopeFundingBatch.deleteMany({ where: { userId: user.id } })
  await prisma.recurringFundingRule.deleteMany({ where: { userId: user.id } })
  await prisma.user.update({
    where: { id: user.id },
    data: { lastPaydayAt: null },
  })
}

export async function getIncomeOverhaulUserId(email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user?.id) throw new Error(`Missing e2e user: ${email}`)
  return user.id
}
