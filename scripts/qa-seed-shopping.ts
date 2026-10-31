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
import { assertShoppingQaSeedEmail, SHOPPING_QA_SEED_EMAILS } from "../lib/shopping-qa-seed"

const prisma = new PrismaClient()

const PASSPHRASE = "4242"

const USERS = [
  {
    email: SHOPPING_QA_SEED_EMAILS.owner,
    name: "Shopping Owner",
    privacyKeyHex: "1111111111111111111111111111111111111111111111111111111111111111",
    saltHex: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  },
  {
    email: SHOPPING_QA_SEED_EMAILS.member,
    name: "Shopping Member",
    privacyKeyHex: "2222222222222222222222222222222222222222222222222222222222222222",
    saltHex: "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
  },
] as const

async function resetUser(email: string): Promise<void> {
  assertShoppingQaSeedEmail(email)
  await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    })
    if (!existing?.email) return
    assertShoppingQaSeedEmail(existing.email)
    await tx.shoppingGroup.deleteMany({ where: { ownerId: existing.id } })
    const deleted = await tx.user.deleteMany({
      where: { id: existing.id, email: existing.email },
    })
    if (deleted.count !== 1) {
      throw new Error("Refusing qa:shopping:seed: the user row did not match the allowlisted email")
    }
  })
}

async function seedUser(spec: (typeof USERS)[number]): Promise<void> {
  assertShoppingQaSeedEmail(spec.email)
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
