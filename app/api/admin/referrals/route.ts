import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")?.trim()
  const codeType = searchParams.get("codeType")?.trim()
  const offerId = searchParams.get("offerId")?.trim()
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200)

  const now = new Date()

  const [totalAccepted, totalActivated, activeTrials, activeGratis, codeSums, recent] =
    await Promise.all([
      prisma.referral.count({ where: { status: "accepted" } }),
      prisma.referral.count({ where: { status: "activated" } }),
      prisma.user.count({
        where: { premiumTrialUntil: { gt: now } },
      }),
      prisma.user.count({
        where: {
          premiumGratisUntil: { gt: now },
          subscriptionTier: { not: "premium" },
        },
      }),
      prisma.referralCode.aggregate({
        _sum: { visitCount: true, usedCount: true },
      }),
      prisma.referral.findMany({
        where: {
          ...(status === "accepted" || status === "activated" ? { status } : {}),
          ...(codeType === "user" || codeType === "offer"
            ? { code: { type: codeType } }
            : {}),
          ...(offerId ? { codeId: offerId } : {}),
        },
        orderBy: { acceptedAt: "desc" },
        take: limit,
        include: {
          code: { select: { code: true, type: true, label: true } },
          referrer: { select: { id: true, name: true, email: true, nostrPubkey: true } },
          referee: { select: { id: true, name: true, email: true, nostrPubkey: true } },
        },
      }),
    ])

  const visits = codeSums._sum.visitCount ?? 0
  const signups = codeSums._sum.usedCount ?? 0

  const shareRows = await prisma.referral.groupBy({
    by: ["shareMethod"],
    _count: { _all: true },
  })

  return NextResponse.json({
    summary: {
      totalAccepted,
      totalActivated,
      activeTrialUsers: activeTrials,
      activeGratisUsers: activeGratis,
      totalVisits: visits,
      totalCodeRedemptions: signups,
    },
    shareMethodBreakdown: shareRows.map((r) => ({
      method: r.shareMethod ?? "unknown",
      count: r._count._all,
    })),
    recent: recent.map((r) => ({
      id: r.id,
      status: r.status,
      shareMethod: r.shareMethod,
      acceptedAt: r.acceptedAt.toISOString(),
      activatedAt: r.activatedAt?.toISOString() ?? null,
      code: r.code.code,
      codeType: r.code.type,
      codeLabel: r.code.label,
      referrer: {
        id: r.referrer.id,
        name: r.referrer.name,
        email: r.referrer.email,
        nostrPubkey: r.referrer.nostrPubkey,
      },
      referee: {
        id: r.referee.id,
        name: r.referee.name,
        email: r.referee.email,
        nostrPubkey: r.referee.nostrPubkey,
      },
    })),
  })
}
