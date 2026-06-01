import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { applyDevPremiumTrialSimulation, isBillingDevSimulateEnabled } from "@/lib/billing-dev-simulate"
import { PREMIUM_PRICE_ANNUAL_USD, PREMIUM_PRICE_MONTHLY_USD } from "@/lib/constants"

/**
 * Starts premium checkout when Stripe is wired; in development simulates a 15-day trial.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const plan = (body as { plan?: unknown }).plan
  if (plan !== "monthly" && plan !== "annual") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  }

  const amountUsd = plan === "monthly" ? PREMIUM_PRICE_MONTHLY_USD : PREMIUM_PRICE_ANNUAL_USD

  if (isBillingDevSimulateEnabled()) {
    const simulated = await applyDevPremiumTrialSimulation(session.user.id)
    if (simulated.ok) {
      return NextResponse.json({
        checkoutUrl: null,
        simulated: true,
        plan,
        amountUsd,
        premiumTrialUntil: simulated.premiumTrialUntil,
        effectiveTier: simulated.effectiveTier,
        message: simulated.message,
      })
    }
    return NextResponse.json({
      checkoutUrl: null,
      simulated: false,
      plan,
      amountUsd,
      reason: simulated.reason,
      message: simulated.message,
    })
  }

  // Production / preview: record interest until Stripe checkout is wired.
  await prisma.user.update({
    where: { id: session.user.id },
    data: { premiumInterestAt: new Date() },
  })

  return NextResponse.json({
    checkoutUrl: null,
    recorded: true,
    plan,
    amountUsd,
    message:
      "Billing checkout is coming soon. We saved your interest and will email you when renewals are live.",
  })
}
