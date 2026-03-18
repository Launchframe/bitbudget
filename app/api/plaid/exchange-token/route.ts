import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { plaidClient } from "@/lib/plaid"
import { premiumForbiddenResponse, requirePremium } from "@/lib/subscription"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!(await requirePremium(session.user.id))) {
    return premiumForbiddenResponse("Bank sync requires a premium subscription")
  }

  const { public_token, institution } = (await req.json()) as {
    public_token?: string
    institution?: { name?: string }
  }
  if (!public_token) {
    return NextResponse.json(
      { error: "public_token required" },
      { status: 400 },
    )
  }
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return NextResponse.json(
      { error: "Plaid is not configured" },
      { status: 503 },
    )
  }

  try {
    const exchangeResponse =
      await plaidClient.itemPublicTokenExchange({ public_token })
    const accessToken = exchangeResponse.data.access_token
    const itemId = exchangeResponse.data.item_id

    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    })

    const plaidItem = await prisma.plaidItem.create({
      data: {
        userId: session.user.id,
        plaidItemId: itemId,
        accessToken,
        institutionName: institution?.name ?? null,
      },
    })

    for (const account of accountsResponse.data.accounts) {
      await prisma.plaidAccount.create({
        data: {
          plaidItemId: plaidItem.id,
          accountName: account.name,
          mask: account.mask ?? null,
          type: account.type,
        },
      })
    }

    return NextResponse.json({ success: true, itemId })
  } catch (err) {
    console.error("Plaid exchange error:", err)
    return NextResponse.json(
      { error: "Failed to exchange token" },
      { status: 500 },
    )
  }
}
