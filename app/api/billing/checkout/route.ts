import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { PREMIUM_PRICE_ANNUAL_USD, PREMIUM_PRICE_MONTHLY_USD } from "@/lib/constants"

/**
 * Starts premium checkout when Stripe is wired; until then records interest.
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

  const stripeReady = Boolean(
    process.env.STRIPE_SECRET_KEY &&
      (plan === "monthly"
        ? process.env.STRIPE_PRICE_ID_MONTHLY
        : process.env.STRIPE_PRICE_ID_ANNUAL),
  )

  if (!stripeReady) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { premiumInterestAt: new Date() },
    })

    return NextResponse.json({
      checkoutUrl: null,
      recorded: true,
      plan,
      amountUsd: plan === "monthly" ? PREMIUM_PRICE_MONTHLY_USD : PREMIUM_PRICE_ANNUAL_USD,
      message:
        "Billing checkout is coming soon. We saved your interest and will email you when renewals are live.",
    })
  }

  return NextResponse.json(
    {
      error: "Not implemented",
      message: "Stripe checkout session creation is not wired yet.",
    },
    { status: 501 },
  )
}
