import { prisma } from "../lib/db"
import { E2E_RECURRING_USER_EMAIL } from "./fixtures/recurring-e2e-constants"

/**
 * Idempotent seed: one user with onboarding complete, one envelope, one active recurring rule
 * with nextDueDate in the past so the next /api/recurring/process creates a transaction.
 */
export async function resetRecurringE2eData(): Promise<void> {
  await prisma.user.deleteMany({
    where: { email: E2E_RECURRING_USER_EMAIL },
  })
}

export async function seedRecurringE2eData(): Promise<void> {
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  yesterday.setUTCHours(12, 0, 0, 0)

  const user = await prisma.user.create({
    data: {
      email: E2E_RECURRING_USER_EMAIL,
      name: "E2E Recurring QA",
      onboardingComplete: true,
      walkthroughCompleted: true,
      monthlyIncome: 5000,
      opportunityCostEnabled: false,
    },
  })

  const envelope = await prisma.envelope.create({
    data: {
      userId: user.id,
      name: "E2E Recurring Envelope",
      monthlyAllotment: 500,
      color: "#F7931A",
    },
  })

  await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      envelopeId: envelope.id,
      payee: "E2E Recurring Payee",
      amount: 9.99,
      type: "expense",
      tags: "[]",
      cadence: "weekly",
      nextDueDate: yesterday,
      active: true,
    },
  })
}

export async function seedRecurringE2e(): Promise<void> {
  await resetRecurringE2eData()
  await seedRecurringE2eData()
}
