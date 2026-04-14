import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { referralStatsForUser } from "@/lib/referral"
import { refereeTrialMonthsForReferrerSubscription, resolveEffectiveTier } from "@/lib/subscription"

/** JSON body for PUT: only these keys are read; extra keys are ignored. */
type UserSettingsPutBody = Partial<{
  monthlyIncome: number
  payCadence: string
  onboardingComplete: boolean
  btcDisplayUnit: string
  opportunityCostEnabled: boolean
  receiptInboxToken: string | null
  name: string | null
}>

const ALLOWED_SETTINGS_PUT_FIELDS = [
  "monthlyIncome",
  "payCadence",
  "onboardingComplete",
  "btcDisplayUnit",
  "opportunityCostEnabled",
  "receiptInboxToken",
  "name",
] as const satisfies readonly (keyof UserSettingsPutBody)[]

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      monthlyIncome: true,
      payCadence: true,
      onboardingComplete: true,
      btcDisplayUnit: true,
      opportunityCostEnabled: true,
      nostrPubkey: true,
      encryptedPrivacyKey: true,
      privacyKeySalt: true,
      receiptInboxToken: true,
      name: true,
      email: true,
      subscriptionTier: true,
      role: true,
      premiumGratisUntil: true,
      premiumTrialUntil: true,
      _count: { select: { transactions: true } },
    },
  })

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { _count, premiumGratisUntil, premiumTrialUntil, ...rest } = user
  const effectiveTier = resolveEffectiveTier({
    subscriptionTier: user.subscriptionTier,
    premiumGratisUntil,
    premiumTrialUntil,
  })

  const refereeReferralRow = await prisma.referral.findUnique({
    where: { refereeId: session.user.id },
    include: { referrer: { select: { subscriptionTier: true } } },
  })
  const isRefereePendingBankLink = refereeReferralRow?.status === "accepted"
  const referralRefereeTrialMonths =
    isRefereePendingBankLink && refereeReferralRow?.referrer
      ? refereeTrialMonthsForReferrerSubscription(refereeReferralRow.referrer.subscriptionTier)
      : null

  let referralPayload: Record<string, unknown> | null = null
  if (user.onboardingComplete) {
    const stats = await referralStatsForUser(session.user.id)
    referralPayload = {
      code: stats.activeCode?.code ?? null,
      codeExpiresAt: stats.activeCode?.expiresAt.toISOString() ?? null,
      lastCode: stats.lastCode
        ? {
            code: stats.lastCode.code,
            expiresAt: stats.lastCode.expiresAt.toISOString(),
            usedCount: stats.lastCode.usedCount,
            active: stats.lastCode.active,
          }
        : null,
      referralCount: stats.referralCount,
      activatedCount: stats.activatedCount,
      premiumGratisUntil: stats.premiumGratisUntil?.toISOString() ?? null,
      premiumTrialUntil: stats.premiumTrialUntil?.toISOString() ?? null,
    }
  }

  return NextResponse.json({
    ...rest,
    premiumGratisUntil: premiumGratisUntil?.toISOString() ?? null,
    premiumTrialUntil: premiumTrialUntil?.toISOString() ?? null,
    effectiveTier,
    transactionCount: _count.transactions,
    referralRefereePendingBankLink: isRefereePendingBankLink,
    referralRefereeTrialMonths,
    referral: referralPayload,
  })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 })
  }
  const body = raw as UserSettingsPutBody

  // Never allow encryptedPrivacyKey / privacyKeySalt via this route — use POST /api/user/encryption
  // (guarded) so existing keys cannot be clobbered by mistake or a buggy client.
  const data: Record<string, unknown> = {}
  for (const field of ALLOWED_SETTINGS_PUT_FIELDS) {
    if (body[field] !== undefined) {
      data[field] = body[field]
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid settings fields to update" },
      { status: 400 },
    )
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: {
      monthlyIncome: true,
      payCadence: true,
      onboardingComplete: true,
      btcDisplayUnit: true,
      receiptInboxToken: true,
      name: true,
    },
  })

  return NextResponse.json(updated)
}
