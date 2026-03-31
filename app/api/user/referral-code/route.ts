import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { ensureUserReferralCode, referralStatsForUser } from "@/lib/referral"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { onboardingComplete: true },
  })
  if (!user?.onboardingComplete) {
    return NextResponse.json(
      { error: "Complete onboarding before generating a referral code" },
      { status: 400 },
    )
  }

  const now = new Date()
  const { code, expiresAt } = await ensureUserReferralCode(session.user.id, now)
  const stats = await referralStatsForUser(session.user.id, now)

  return NextResponse.json({
    code,
    expiresAt: expiresAt.toISOString(),
    referralCount: stats.referralCount,
    activatedCount: stats.activatedCount,
    premiumGratisUntil: stats.premiumGratisUntil?.toISOString() ?? null,
  })
}
