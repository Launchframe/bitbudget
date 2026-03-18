import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"
import { logAdminAction } from "@/lib/audit-log"

const VALID_TIERS = ["free", "premium"] as const

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { error, user: admin } = await requireAdmin()
  if (error) return error
  if (!admin?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { userId } = await params
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })

  const body = await _req.json().catch(() => ({}))
  const tier = body.subscriptionTier
  if (typeof tier !== "string" || !VALID_TIERS.includes(tier as (typeof VALID_TIERS)[number])) {
    return NextResponse.json(
      { error: "subscriptionTier must be 'free' or 'premium'" },
      { status: 400 },
    )
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, subscriptionTier: true },
  })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })

  await prisma.user.update({
    where: { id: userId },
    data: { subscriptionTier: tier },
  })

  await logAdminAction(admin.id, "user.tier_updated", "User", userId, {
    previousTier: target.subscriptionTier,
    newTier: tier,
  })

  return NextResponse.json({ subscriptionTier: tier })
}
