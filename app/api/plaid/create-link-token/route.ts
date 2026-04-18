import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { plaidClient } from "@/lib/plaid"
import {
  premiumForbiddenResponse,
  requirePremiumOrTrialOrReferralBankLinkPending,
} from "@/lib/subscription"
import { CountryCode, Products } from "plaid"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!(await requirePremiumOrTrialOrReferralBankLinkPending(session.user.id))) {
    return premiumForbiddenResponse(
      "Bank sync requires premium, an active trial, or an accepted referral (link a bank to finish signup)",
    )
  }
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return NextResponse.json(
      { error: "Plaid is not configured" },
      { status: 503 },
    )
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: session.user.id },
      client_name: "bitbudget",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    })

    return NextResponse.json({ link_token: response.data.link_token })
  } catch (err) {
    console.error("Plaid link token error:", err)
    return NextResponse.json(
      { error: "Failed to create link token" },
      { status: 500 },
    )
  }
}
