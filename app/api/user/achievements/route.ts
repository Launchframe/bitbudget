import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const limitRaw = req.nextUrl.searchParams.get("limit")
  let take: number | undefined
  if (limitRaw != null) {
    const n = Number(limitRaw)
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      return NextResponse.json({ error: "limit must be 1–100" }, { status: 400 })
    }
    take = Math.floor(n)
  }

  const rows = await prisma.userAchievement.findMany({
    where: { userId: session.user.id },
    orderBy: { earnedAt: "desc" },
    ...(take != null ? { take } : {}),
  })

  return NextResponse.json({
    achievements: rows.map((r) => ({
      code: r.code,
      earnedAt: r.earnedAt.toISOString(),
      metadata: r.metadata,
    })),
  })
}
