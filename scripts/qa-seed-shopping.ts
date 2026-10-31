/**
 * Local QA helper: reset two signed-in users for the shared shopping flow.
 *
 * Usage:
 *   pnpm qa:shopping:seed
 *
 * Sign in at /auth with the printed emails and code 424242 (requires the dev
 * server to run with E2E_TEST=true and E2E_EMAIL_CODE=424242), then unlock with
 * passphrase 4242. Requires DATABASE_URL. Never run against production.
 */

import { PrismaClient } from "@prisma/client"
import {
  deriveKeyFromPin,
  encryptPrivacyKey,
  generateKeyPairFromSeed,
  hexToUint8,
  publicKeyToHex,
} from "../lib/crypto"

const prisma = new PrismaClient()

const PASSPHRASE = "4242"

const USERS = [
  {
    email: "shopping-owner@bitbudget.test",
    name: "Shopping Owner",
    privacyKeyHex: "1111111111111111111111111111111111111111111111111111111111111111",
    saltHex: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  },
  {
    email: "shopping-member@bitbudget.test",
    name: "Shopping Member",
    privacyKeyHex: "2222222222222222222222222222222222222222222222222222222222222222",
    saltHex: "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
  },
] as const

function assertQaTestEmail(email: string): void {
  if (!email.endsWith("@bitbudget.test")) {
    throw new Error(`Refusing qa:shopping:seed for non-test email: ${email}`)
  }
}

async function resetUser(email: string): Promise<void> {
  assertQaTestEmail(email)
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!existing) return
  await prisma.shoppingGroup.deleteMany({ where: { ownerId: existing.id } })
  await prisma.user.delete({ where: { id: existing.id } })
}

async function seedUser(spec: (typeof USERS)[number]): Promise<void> {
  assertQaTestEmail(spec.email)
  const privacyKey = hexToUint8(spec.privacyKeyHex)
  const wrappingKey = await deriveKeyFromPin(PASSPHRASE, hexToUint8(spec.saltHex))
  const wrapped = await encryptPrivacyKey(privacyKey, wrappingKey)
  const { publicKey } = generateKeyPairFromSeed(privacyKey)

  const user = await prisma.user.create({
    data: {
      email: spec.email,
      name: spec.name,
      onboardingComplete: true,
      walkthroughCompleted: true,
      monthlyIncome: 4000,
      payCadence: "monthly",
      opportunityCostEnabled: false,
      savingsExperience: "engaged",
      encryptedPrivacyKey: JSON.stringify(wrapped),
      privacyKeySalt: spec.saltHex,
      publicKey: publicKeyToHex(publicKey),
    },
  })
  await prisma.envelope.create({
    data: { userId: user.id, name: "Groceries", monthlyAllotment: 400, color: "#10B981" },
  })
}

function refuseProduction(): void {
  if (process.env.VERCEL_ENV === "production") {
    console.error("Refusing to run qa:shopping:seed when VERCEL_ENV=production.")
    process.exit(1)
  }
}

async function main() {
  refuseProduction()
  for (const spec of USERS) {
    await resetUser(spec.email)
    await seedUser(spec)
  }
  console.log("Shopping QA users are ready. Sign-in code: 424242. Passphrase: 4242.")
  for (const spec of USERS) console.log(`  ${spec.email}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
