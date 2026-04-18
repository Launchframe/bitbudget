import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const { searchParams } = new URL(req.url)
  const rating = searchParams.get("rating")?.trim()
  const trigger = searchParams.get("trigger")?.trim()
  const completedOnly = searchParams.get("completedOnly") === "1"
  const sinceRaw = searchParams.get("since")?.trim()
  const untilRaw = searchParams.get("until")?.trim()
  const since = sinceRaw ? new Date(sinceRaw) : null
  const until = untilRaw ? new Date(untilRaw) : null
  const dateOk = (d: Date) => !Number.isNaN(d.getTime())

  const updatedAtFilter =
    (since && dateOk(since)) || (until && dateOk(until))
      ? {
          ...(since && dateOk(since) ? { gte: since } : {}),
          ...(until && dateOk(until) ? { lte: until } : {}),
        }
      : undefined

  const rows = await prisma.survey.findMany({
    where: {
      ...(rating === "up" || rating === "down" ? { rating } : {}),
      ...(trigger ? { triggerType: trigger } : {}),
      ...(completedOnly ? { completedAt: { not: null } } : {}),
      ...(updatedAtFilter ? { updatedAt: updatedAtFilter } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: {
      user: {
        select: { id: true, name: true, email: true, nostrPubkey: true },
      },
    },
  })

  const completed = rows.filter((r) => r.completedAt)
  const up = completed.filter((r) => r.rating === "up").length
  const down = completed.filter((r) => r.rating === "down").length
  const denom = up + down

  return NextResponse.json({
    summary: {
      total: rows.length,
      completed: completed.length,
      thumbsUpPct: denom ? up / denom : 0,
      thumbsDownPct: denom ? down / denom : 0,
      avgStep:
        rows.length === 0
          ? 0
          : rows.reduce((s, r) => s + r.currentStep, 0) / rows.length,
    },
    responses: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      user: r.user,
      triggerType: r.triggerType,
      rating: r.rating,
      favoriteFeature: r.favoriteFeature,
      leastFavorite: r.leastFavorite,
      comments: r.comments,
      canContact: r.canContact,
      currentStep: r.currentStep,
      completedAt: r.completedAt?.toISOString() ?? null,
      dismissedAt: r.dismissedAt?.toISOString() ?? null,
      dismissType: r.dismissType,
      updatedAt: r.updatedAt.toISOString(),
    })),
  })
}
