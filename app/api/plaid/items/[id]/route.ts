import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { plaidClient, plaidSecret } from "@/lib/plaid"

function plaidErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object" || !("response" in err)) return null
  const data = (err as { response?: { data?: { error_code?: unknown } } }).response?.data
  return typeof data?.error_code === "string" ? data.error_code : null
}

function plaidItemAlreadyRemoved(err: unknown): boolean {
  const code = plaidErrorCode(err)?.toUpperCase()
  return code === "ITEM_NOT_FOUND" || code === "INVALID_ACCESS_TOKEN"
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!process.env.PLAID_CLIENT_ID || !plaidSecret) {
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
    if (plaidItemAlreadyRemoved(err)) {
      await prisma.plaidItem.delete({ where: { id: plaidItem.id } })
      return NextResponse.json({ success: true })
    }
    console.error("Plaid itemRemove error:", err)
    return NextResponse.json(
      { error: "Failed to disconnect bank" },
      { status: 502 },
    )
  }

  // If this delete fails after Plaid succeeds, a retry can still clear the local row because
  // already-removed Plaid items are treated as successful disconnects above.
  await prisma.plaidItem.delete({ where: { id: plaidItem.id } })

  return NextResponse.json({ success: true })
}
