import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export type SubscriptionTier = "free" | "premium"

export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true },
  })
  const tier = user?.subscriptionTier
  return tier === "free" || tier === "premium" ? tier : "free"
}

export async function requirePremium(userId: string): Promise<boolean> {
  const tier = await getUserTier(userId)
  return tier === "premium"
}

/** JSON 403 for authenticated routes that require premium. */
export function premiumForbiddenResponse(
  message = "This feature requires a premium subscription",
): NextResponse {
  return NextResponse.json({ error: "Forbidden", message }, { status: 403 })
}
