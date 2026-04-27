import { prisma } from "../lib/db"
import {
  E2E_TRANSACTION_CRUD_BIMONTHLY_EMAIL,
  E2E_TRANSACTION_CRUD_MONTHLY_EMAIL,
  E2E_TRANSACTION_CRUD_USER_EMAILS,
} from "./fixtures/transaction-crud-e2e-constants"

async function createTransactionUser(email: string, payCadence: "monthly" | "bimonthly"): Promise<void> {
  const user = await prisma.user.create({
    data: {
      email,
      name: email === E2E_TRANSACTION_CRUD_MONTHLY_EMAIL ? "E2E Transaction Monthly" : "E2E Transaction Bimonthly",
      onboardingComplete: true,
      monthlyIncome: 4000,
      payCadence,
      opportunityCostEnabled: false,
    },
  })

  const groceries = await prisma.envelope.create({
    data: {
      userId: user.id,
      name: "E2E Groceries",
      monthlyAllotment: 500,
      color: "#F7931A",
    },
  })

  await prisma.envelope.create({
    data: {
      userId: user.id,
      name: "E2E Dining",
      monthlyAllotment: 300,
      color: "#22C55E",
    },
  })

  await prisma.tag.createMany({
    data: [
      { userId: user.id, name: "planned" },
      { userId: user.id, name: "household" },
    ],
  })

  await prisma.transactionShortcut.create({
    data: {
      userId: user.id,
      envelopeId: groceries.id,
      payee: "E2E Coffee Shortcut",
      defaultAmount: 4.5,
      label: "Coffee",
    },
  })
}

export async function resetTransactionCrudE2eData(): Promise<void> {
  await prisma.user.deleteMany({
    where: { email: { in: E2E_TRANSACTION_CRUD_USER_EMAILS } },
  })
}

export async function seedTransactionCrudE2eData(): Promise<void> {
  await createTransactionUser(E2E_TRANSACTION_CRUD_MONTHLY_EMAIL, "monthly")
  await createTransactionUser(E2E_TRANSACTION_CRUD_BIMONTHLY_EMAIL, "bimonthly")
}

export async function seedTransactionCrudE2e(): Promise<void> {
  await resetTransactionCrudE2eData()
  await seedTransactionCrudE2eData()
}
