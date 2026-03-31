import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"
import { isValidOfferSlug, normalizeOfferSlug } from "@/lib/referral"

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const offers = await prisma.referralCode.findMany({
    where: { type: "offer" },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { referrals: true } },
    },
  })

  const now = new Date()
  return NextResponse.json(
    offers.map((o) => ({
      id: o.id,
      code: o.code,
      label: o.label,
      maxUses: o.maxUses,
      usedCount: o.usedCount,
      visitCount: o.visitCount,
      startsAt: o.startsAt.toISOString(),
      expiresAt: o.expiresAt.toISOString(),
      active: o.active,
      referralCount: o._count.referrals,
      expired: o.expiresAt <= now || !o.active,
    })),
  )
}

export async function POST(req: NextRequest) {
  const { error, user } = await requireAdmin()
  if (error || !user?.id) return error!

  let body: {
    code?: string
    label?: string | null
    maxUses?: number
    startsAt?: string
    expiresAt?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const slug = typeof body.code === "string" ? normalizeOfferSlug(body.code) : ""
  if (!isValidOfferSlug(slug)) {
    return NextResponse.json(
      { error: "Invalid code: use lowercase letters, numbers, single hyphens" },
      { status: 400 },
    )
  }

  const clash = await prisma.referralCode.findUnique({ where: { code: slug } })
  if (clash) {
    return NextResponse.json({ error: "Code already in use" }, { status: 409 })
  }

  const maxUses =
    typeof body.maxUses === "number" && Number.isFinite(body.maxUses) && body.maxUses >= 1
      ? Math.min(Math.floor(body.maxUses), 1_000_000)
      : 100

  const startsAt = body.startsAt ? new Date(body.startsAt) : new Date()
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(startsAt.getTime() + 90 * 86400000)
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime()) || expiresAt <= startsAt) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 })
  }

  const row = await prisma.referralCode.create({
    data: {
      code: slug,
      type: "offer",
      ownerId: user.id,
      label: typeof body.label === "string" ? body.label.slice(0, 200) : null,
      maxUses,
      usedCount: 0,
      visitCount: 0,
      startsAt,
      expiresAt,
      active: true,
    },
  })

  return NextResponse.json({
    id: row.id,
    code: row.code,
    label: row.label,
    maxUses: row.maxUses,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  })
}
