import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { plaidClient } from "@/lib/plaid"

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return NextResponse.json(
      { error: "Plaid is not configured" },
      { status: 503 },
    )
  }

  const { id } = await ctx.params
  const plaidItem = await prisma.plaidItem.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, accessToken: true },
  })
  if (!plaidItem) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    await plaidClient.itemRemove({ access_token: plaidItem.accessToken })
  } catch (err) {
    console.error("Plaid itemRemove error:", err)
    return NextResponse.json(
      { error: "Failed to disconnect bank" },
      { status: 502 },
    )
  }

  await prisma.plaidItem.delete({ where: { id: plaidItem.id } })

  return NextResponse.json({ success: true })
}
