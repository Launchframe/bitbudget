import { prisma } from "@/lib/db"

export type SubscriptionTier = "free" | "premium"

export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true },
  })
  return (user?.subscriptionTier as SubscriptionTier) ?? "free"
}

export async function requirePremium(userId: string): Promise<boolean> {
  const tier = await getUserTier(userId)
  return tier === "premium"
}
