import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

/** Stored in DB (Stripe / billing). Trial is derived from `premiumTrialUntil`, not this field. */
export type SubscriptionTier = "free" | "premium"

/** Resolved tier including referral trial and gratis premium windows. */
export type EffectiveSubscriptionTier = "free" | "premium-trial" | "premium"

const RECEIPT_SMS_SOURCES = ["email_forward", "sms"] as const

export const PREMIUM_TRIAL_RECEIPT_SMS_MONTHLY_CAP = 100

export function resolveEffectiveTier(
  row: {
    subscriptionTier: string
    premiumGratisUntil: Date | null
    premiumTrialUntil: Date | null
  },
  now: Date = new Date(),
): EffectiveSubscriptionTier {
  if (row.subscriptionTier === "premium") return "premium"
  if (row.premiumGratisUntil && row.premiumGratisUntil > now) return "premium"
  if (row.premiumTrialUntil && row.premiumTrialUntil > now) return "premium-trial"
  return "free"
}

export async function effectiveUserTier(userId: string): Promise<EffectiveSubscriptionTier> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionTier: true,
      premiumGratisUntil: true,
      premiumTrialUntil: true,
    },
  })
  if (!user) return "free"
  return resolveEffectiveTier(user)
}

/** @deprecated Prefer `effectiveUserTier`; kept for callers that only need stored billing tier. */
export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true },
  })
  const tier = user?.subscriptionTier
  return tier === "free" || tier === "premium" ? tier : "free"
}

/** Paid or gratis premium (not trial). */
export async function requirePremium(userId: string): Promise<boolean> {
  const t = await effectiveUserTier(userId)
  return t === "premium"
}

/** Premium or premium-trial (e.g. Plaid, receipt inbox). */
export async function requirePremiumOrTrial(userId: string): Promise<boolean> {
  const t = await effectiveUserTier(userId)
  return t === "premium" || t === "premium-trial"
}

export async function countTrialReceiptSmsSubmissionsThisMonth(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const [txn, pending] = await Promise.all([
    prisma.transaction.count({
      where: {
        userId,
        source: { in: [...RECEIPT_SMS_SOURCES] },
        createdAt: { gte: start, lt: end },
      },
    }),
    prisma.pendingTransaction.count({
      where: {
        userId,
        source: { in: [...RECEIPT_SMS_SOURCES] },
        createdAt: { gte: start, lt: end },
      },
    }),
  ])
  return txn + pending
}

/**
 * Trial users are capped on combined email_forward + SMS capture; full premium is unlimited.
 */
export async function assertPremiumTrialInboxAllowed(
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const tier = await effectiveUserTier(userId)
  if (tier === "premium") return { ok: true }
  if (tier === "premium-trial") {
    const n = await countTrialReceiptSmsSubmissionsThisMonth(userId, now)
    if (n >= PREMIUM_TRIAL_RECEIPT_SMS_MONTHLY_CAP) {
      return {
        ok: false,
        message: `Premium trial allows up to ${PREMIUM_TRIAL_RECEIPT_SMS_MONTHLY_CAP} receipt or SMS captures per month. Upgrade for unlimited.`,
      }
    }
    return { ok: true }
  }
  return {
    ok: false,
    message: "Receipt inbox requires premium or an active premium trial.",
  }
}

/** JSON 403 for authenticated routes that require premium. */
export function premiumForbiddenResponse(
  message = "This feature requires a premium subscription",
): NextResponse {
  return NextResponse.json({ error: "Forbidden", message }, { status: 403 })
}
