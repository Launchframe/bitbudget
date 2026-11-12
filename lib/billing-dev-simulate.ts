import {
  DEV_PREMIUM_SIMULATE_TRIAL_DAYS,
  isBillingDevSimulateEnabled,
} from "@/lib/billing-constants"
import { prisma } from "@/lib/db"
import { resolveEffectiveTier } from "@/lib/subscription"

export { DEV_PREMIUM_SIMULATE_TRIAL_DAYS, isBillingDevSimulateEnabled }

export function computeDevPremiumTrialUntil(
  existingUntil: Date | null,
  now: Date = new Date(),
): Date {
  const base =
    existingUntil && existingUntil.getTime() > now.getTime() ? existingUntil : now
  const end = new Date(base)
  end.setUTCDate(end.getUTCDate() + DEV_PREMIUM_SIMULATE_TRIAL_DAYS)
  return end
}

export type DevPremiumSimulateResult =
  | {
      ok: true
      simulated: true
      premiumTrialUntil: string
      effectiveTier: "premium-trial" | "premium"
      message: string
    }
  | { ok: false; reason: "already_premium"; message: string }

/**
 * Grants (or extends) premium trial for local development checkout simulation.
 * No-op outside `NODE_ENV === "development"`.
 */
export async function applyDevPremiumTrialSimulation(
  userId: string,
): Promise<DevPremiumSimulateResult> {
  if (!isBillingDevSimulateEnabled()) {
    throw new Error("Dev premium simulation is only available in development")
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionTier: true,
      premiumGratisUntil: true,
      premiumTrialUntil: true,
      premiumMembershipUntil: true,
    },
  })

  if (!user) {
    throw new Error("User not found")
  }

  const now = new Date()
  const effectiveBefore = resolveEffectiveTier(user, now)
  if (effectiveBefore === "premium") {
    return {
      ok: false,
      reason: "already_premium",
      message: "You already have Premium access on this account.",
    }
  }

  const premiumTrialUntil = computeDevPremiumTrialUntil(user.premiumTrialUntil, now)

  await prisma.user.update({
    where: { id: userId },
    data: { premiumTrialUntil },
  })

  const effectiveTier = resolveEffectiveTier(
    {
      ...user,
      premiumTrialUntil,
    },
    now,
  )

  return {
    ok: true,
    simulated: true,
    premiumTrialUntil: premiumTrialUntil.toISOString(),
    effectiveTier: effectiveTier === "free" ? "premium-trial" : effectiveTier,
    message: `Development: Premium trial active through ${premiumTrialUntil.toISOString().slice(0, 10)} (${DEV_PREMIUM_SIMULATE_TRIAL_DAYS} days).`,
  }
}
