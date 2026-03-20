import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/**
 * Records that the signed-in user expressed interest in Premium (upgrade CTA).
 * No-op for users who are already on the premium tier.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true, email: true },
  })

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (user.subscriptionTier === "premium") {
    return NextResponse.json({ recorded: false, reason: "already_premium" })
  }

  const hasEmail = Boolean(user.email?.trim())

  await prisma.user.update({
    where: { id: userId },
    data: { premiumInterestAt: new Date() },
  })

  return NextResponse.json({ recorded: true, hasEmail })
}
