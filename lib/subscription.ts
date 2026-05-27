import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

/** Stored in DB (Stripe / billing). Trial is derived from `premiumTrialUntil`, not this field. */
export type SubscriptionTier = "free" | "premium"

/** Resolved tier including referral trial and gratis premium windows. */
export type EffectiveSubscriptionTier = "free" | "premium-trial" | "premium"

const PREMIUM_CAPTURE_SOURCES = ["email_forward", "sms", "notification_forward"] as const

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

/** Months of referee premium trial after first bank link, by referrer’s paid billing tier (not gratis). */
export function refereeTrialMonthsForReferrerSubscription(subscriptionTier: string): 1 | 3 {
  return subscriptionTier === "premium" ? 3 : 1
}

/** Referee marketing line — duration matches referrer billing tier (see `refereeTrialMonthsForReferrerSubscription`). */
export function refereePremiumExperienceCarrot(months: 1 | 3): string {
  return months === 3
    ? "Connect your bank account and enjoy 3 months of the premium BitBudget experience. No payment details required."
    : "Connect your bank account and enjoy 1 month of the premium BitBudget experience. No payment details required."
}

export const REFEREE_PREMIUM_CARROT_FALLBACK =
  "Connect your bank account to enjoy the premium BitBudget experience. No payment details required."

/** True when this user redeemed a referral but has not linked a bank yet (Referral.status === accepted). */
export async function referralRefereePendingBankLink(userId: string): Promise<boolean> {
  const row = await prisma.referral.findUnique({
    where: { refereeId: userId },
    select: { status: true },
  })
  return row?.status === "accepted"
}

/**
 * Plaid only: allow premium/trial, or a referred user who must link a bank before other premium features unlock.
 */
export async function requirePremiumOrTrialOrReferralBankLinkPending(userId: string): Promise<boolean> {
  if (await requirePremiumOrTrial(userId)) return true
  return referralRefereePendingBankLink(userId)
}

export async function countTrialReceiptSmsSubmissionsThisMonth(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0))
  const [txn, pending] = await Promise.all([
    prisma.transaction.count({
      where: {
        userId,
        source: { in: [...PREMIUM_CAPTURE_SOURCES] },
        createdAt: { gte: start, lt: end },
      },
    }),
    prisma.pendingTransaction.count({
      where: {
        userId,
        source: { in: [...PREMIUM_CAPTURE_SOURCES] },
        createdAt: { gte: start, lt: end },
      },
    }),
  ])
  return txn + pending
}

/**
 * Trial users are capped on combined email_forward, SMS, and notification_forward capture; full premium is unlimited.
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
        message: `Premium trial allows up to ${PREMIUM_TRIAL_RECEIPT_SMS_MONTHLY_CAP} receipt, SMS, or notification captures per month. Upgrade for unlimited.`,
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
  message = "This feature requires a premium subscription or an active premium trial",
): NextResponse {
  return NextResponse.json({ error: "Forbidden", message }, { status: 403 })
}
