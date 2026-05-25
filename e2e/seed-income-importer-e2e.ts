import { prisma } from "../lib/db"
import { ensureSystemSavingsEnvelope } from "../lib/ensure-system-savings-envelope"
import {
  E2E_INCOME_IMPORT_PUBLIC_KEY,
  E2E_INCOME_IMPORT_USER_EMAIL,
  E2E_INCOME_IMPORT_ZERO_MI_EMAIL,
} from "./fixtures/income-importer-e2e-constants"

async function resetIncomeImporterUsers(): Promise<void> {
  await prisma.user.deleteMany({
    where: {
      email: { in: [E2E_INCOME_IMPORT_USER_EMAIL, E2E_INCOME_IMPORT_ZERO_MI_EMAIL] },
    },
  })
}

async function seedIncomeImporterUser(email: string, monthlyIncome: number): Promise<void> {
  const user = await prisma.user.create({
    data: {
      email,
      name: email.startsWith("e2e-income-import-zero") ? "E2E Income Import Zero MI" : "E2E Income Import",
      onboardingComplete: true,
      walkthroughCompleted: true,
      monthlyIncome,
      opportunityCostEnabled: false,
      savingsExperience: "engaged",
      publicKey: E2E_INCOME_IMPORT_PUBLIC_KEY,
      payDays: [15],
    },
  })

  await ensureSystemSavingsEnvelope(user.id)
}

export async function seedIncomeImporterE2e(): Promise<void> {
  await resetIncomeImporterUsers()
  await seedIncomeImporterUser(E2E_INCOME_IMPORT_USER_EMAIL, 5000)
  await seedIncomeImporterUser(E2E_INCOME_IMPORT_ZERO_MI_EMAIL, 0)
}

/** Clear staged imports between tests while keeping the seeded user row. */
export async function resetIncomeImporterUserData(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) return
  await prisma.transaction.deleteMany({ where: { userId: user.id } })
  await prisma.envelopeFundingBatch.deleteMany({ where: { userId: user.id } })
}
