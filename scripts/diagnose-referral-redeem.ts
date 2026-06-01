/**
 * Diagnose referral redeem for a code + optional referee email.
 * Usage: npx tsx scripts/diagnose-referral-redeem.ts ZMRNMWHT [referee@email]
 */
import { prisma } from "../lib/db"
import { redeemReferralCode, validateReferralCodeRow } from "../lib/referral"

async function main() {
  const code = (process.argv[2] ?? "").trim()
  const refereeEmail = process.argv[3]?.trim()
  if (!code) throw new Error("Usage: npx tsx scripts/diagnose-referral-redeem.ts <CODE> [refereeEmail]")

  const dbName = (process.env.DATABASE_URL ?? "").match(/\/([^/?]+)(\?|$)/)?.[1] ?? "?"
  console.error("database:", dbName)

  const tz = await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW TIME ZONE`
  console.error("session TZ:", tz[0]?.TimeZone)

  const now = new Date()
  const row = await prisma.referralCode.findUnique({ where: { code: code.toUpperCase() } })
  console.log("row:", row)

  const v = await validateReferralCodeRow(code, now)
  console.log("validate:", v)

  if (row) {
    const [checks] = await prisma.$queryRaw<
      Array<{
        naive_starts_ok: boolean
        utc_starts_ok: boolean
        naive_expires_ok: boolean
        utc_expires_ok: boolean
        uses_ok: boolean
      }>
    >`
      SELECT
        "startsAt" <= ${now} AS naive_starts_ok,
        ("startsAt" AT TIME ZONE 'UTC') <= ${now} AS utc_starts_ok,
        "expiresAt" > ${now} AS naive_expires_ok,
        ("expiresAt" AT TIME ZONE 'UTC') > ${now} AS utc_expires_ok,
        "usedCount" < "maxUses" AS uses_ok
      FROM "ReferralCode"
      WHERE id = ${row.id}
    `
    console.log("sql checks:", checks)

    const bumped = await prisma.$executeRaw`
      UPDATE "ReferralCode"
      SET "usedCount" = "usedCount" + 1
      WHERE "id" = ${row.id}
        AND "active" = true
        AND ("startsAt" AT TIME ZONE 'UTC') <= ${now}
        AND ("expiresAt" AT TIME ZONE 'UTC') > ${now}
        AND "usedCount" < "maxUses"
    `
    console.log("bump rows (fixed SQL):", bumped)
    if (Number(bumped) === 1) {
      await prisma.referralCode.update({
        where: { id: row.id },
        data: { usedCount: { decrement: 1 } },
      })
      console.log("(rolled back bump)")
    }
  }

  let refereeId = refereeEmail
    ? (await prisma.user.findUnique({ where: { email: refereeEmail }, select: { id: true } }))?.id
    : undefined

  if (!refereeId) {
    const admin = await prisma.user.findFirst({
      where: { role: "admin" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
    const referee = await prisma.user.findFirst({
      where: {
        role: { not: "admin" },
        ...(admin ? { id: { not: admin.id } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, onboardingComplete: true, onboardingCompletedAt: true },
    })
    refereeId = referee?.id
    console.log("referee:", referee)
  }

  if (refereeId) {
    const existing = await prisma.referral.findUnique({ where: { refereeId } })
    console.log("existing referral:", existing)
    const result = await redeemReferralCode({ refereeId, rawCode: code, now })
    console.log("redeem:", result)
  }

  const referrals = await prisma.referral.findMany({
    where: { codeId: row?.id },
    include: {
      referee: { select: { id: true, email: true, name: true, onboardingCompletedAt: true } },
      referrer: { select: { id: true, email: true, name: true } },
    },
  })
  console.log("referrals for code:", JSON.stringify(referrals, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
