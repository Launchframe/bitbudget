import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { referralStatsForUser } from "@/lib/referral"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const stats = await referralStatsForUser(session.user.id, now)

  return NextResponse.json({
    code: stats.activeCode?.code ?? null,
    codeExpiresAt: stats.activeCode?.expiresAt.toISOString() ?? null,
    lastCode: stats.lastCode
      ? {
          code: stats.lastCode.code,
          expiresAt: stats.lastCode.expiresAt.toISOString(),
          usedCount: stats.lastCode.usedCount,
          active: stats.lastCode.active,
        }
      : null,
    referralCount: stats.referralCount,
    activatedCount: stats.activatedCount,
    premiumGratisUntil: stats.premiumGratisUntil?.toISOString() ?? null,
    premiumTrialUntil: stats.premiumTrialUntil?.toISOString() ?? null,
    effectiveTier: stats.effectiveTier,
  })
}
