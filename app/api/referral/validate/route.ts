import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { validateReferralCodeRow } from "@/lib/referral"
import { refereeTrialMonthsForReferrerSubscription } from "@/lib/subscription"

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim() ?? ""
  if (!code) {
    return NextResponse.json({ valid: false, type: null as string | null })
  }

  const v = await validateReferralCodeRow(code)
  if (!v.valid) {
    return NextResponse.json({ valid: false, type: null as string | null })
  }

  const referrer = await prisma.user.findUnique({
    where: { id: v.codeRow.ownerId },
    select: { subscriptionTier: true },
  })
  const refereeTrialMonths = referrer
    ? refereeTrialMonthsForReferrerSubscription(referrer.subscriptionTier)
    : undefined

  return NextResponse.json({
    valid: true,
    type: v.type,
    referrerName: v.type === "user" ? v.referrerName : undefined,
    label: v.type === "offer" ? (v.codeRow.label ?? undefined) : undefined,
    refereeTrialMonths,
  })
}
