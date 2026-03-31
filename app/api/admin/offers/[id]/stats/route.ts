import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await ctx.params
  const code = await prisma.referralCode.findFirst({
    where: { id, type: "offer" },
  })
  if (!code) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const referrals = await prisma.referral.findMany({
    where: { codeId: id },
    include: {
      referee: {
        select: {
          id: true,
          name: true,
          email: true,
          nostrPubkey: true,
          createdAt: true,
          onboardingComplete: true,
          subscriptionTier: true,
          premiumTrialUntil: true,
          referredByCodeId: true,
          _count: { select: { transactions: true } },
        },
      },
    },
  })

  const activated = referrals.filter((r) => r.status === "activated")
  const times = activated
    .map((r) =>
      r.activatedAt && r.acceptedAt
        ? r.activatedAt.getTime() - r.acceptedAt.getTime()
        : null,
    )
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)
  const medianMs =
    times.length === 0 ? null : times[Math.floor(times.length / 2)]!

  const refereeIds = referrals.map((r) => r.refereeId)
  const becameReferrers = await prisma.referralCode.count({
    where: { type: "user", ownerId: { in: refereeIds } },
  })
  const kFactor = refereeIds.length ? becameReferrers / refereeIds.length : 0

  const now = new Date()
  const expiredTrialUpgraded = await prisma.user.count({
    where: {
      id: { in: refereeIds },
      subscriptionTier: "premium",
      premiumTrialUntil: { lt: now },
    },
  })
  const expiredTrials = await prisma.user.count({
    where: {
      id: { in: refereeIds },
      premiumTrialUntil: { lt: now },
    },
  })
  const trialConversion = expiredTrials ? expiredTrialUpgraded / expiredTrials : 0

  return NextResponse.json({
    code: code.code,
    label: code.label,
    visitCount: code.visitCount,
    usedCount: code.usedCount,
    maxUses: code.maxUses,
    referralCount: referrals.length,
    activatedCount: activated.length,
    medianTimeToActivationMs: medianMs,
    kFactor,
    trialToPaidRate: trialConversion,
    users: referrals.map((r) => ({
      refereeId: r.refereeId,
      name: r.referee.name,
      email: r.referee.email,
      nostrPubkey: r.referee.nostrPubkey,
      signupAt: r.referee.createdAt.toISOString(),
      onboardingComplete: r.referee.onboardingComplete,
      status: r.status,
      trialUntil: r.referee.premiumTrialUntil?.toISOString() ?? null,
      transactionCount: r.referee._count.transactions,
      subscriptionTier: r.referee.subscriptionTier,
    })),
  })
}
