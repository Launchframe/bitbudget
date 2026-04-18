import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  E2E_OFFER_SLUG,
  E2E_USER_CODE_FREE_REFERRER,
  E2E_USER_CODE_PREMIUM_REFERRER,
} from "@/e2e/fixtures/referral-e2e-constants"

function pgHostFromDatabaseUrl(url: string | undefined): string | null {
  if (!url) return null
  const m = url.match(/@([^/?]+)(?:\/|\?|$)/)
  return m?.[1] ?? null
}

/**
 * Resets e2e referral rows the Playwright suite depends on. Only when E2E_TEST is set.
 * Ensures the running Next server’s DB matches what tests expect (usedCount, stray referrals).
 */
export async function POST() {
  if (process.env.E2E_TEST !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.referral.deleteMany({
    where: {
      referee: {
        AND: [{ email: { startsWith: "e2e-referee" } }, { email: { endsWith: "@bitbudget.test" } }],
      },
    },
  })

  const t = new Date()
  const startsAt = new Date(t.getTime() - 86400000)
  const expiresAt = new Date(t.getTime() + 30 * 86400000)
  await prisma.referralCode.updateMany({
    where: {
      code: { in: [E2E_USER_CODE_PREMIUM_REFERRER, E2E_USER_CODE_FREE_REFERRER, E2E_OFFER_SLUG] },
    },
    data: { usedCount: 0, active: true, startsAt, expiresAt },
  })

  return NextResponse.json({
    ok: true,
    dbHost: pgHostFromDatabaseUrl(process.env.DATABASE_URL),
  })
}
