/**
 * Print a valid user referral code owned by the earliest admin (by createdAt).
 *
 * Usage:
 *   pnpm referral:admin-code
 *
 * Requires DATABASE_URL (e.g. from .env). Prints the code on stdout; owner info on stderr.
 */

import { prisma } from "../lib/db"
import { ensureUserReferralCode } from "../lib/referral"

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: "admin" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, createdAt: true },
  })

  if (!admin) {
    throw new Error(
      "No admin user found (role = admin). Set one via ADMIN_EMAILS + pnpm db:seed-admin.",
    )
  }

  const row = await ensureUserReferralCode(admin.id)
  const ownerLabel = admin.email ?? admin.name ?? admin.id
  console.error(`Referral code for admin ${ownerLabel} (created ${admin.createdAt.toISOString()}):`)
  console.log(row.code)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
