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
