import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { premiumForbiddenResponse, requirePremium } from "@/lib/subscription"

function generateToken() {
  return randomBytes(16).toString("hex")
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!(await requirePremium(session.user.id))) {
    return premiumForbiddenResponse("Receipt inbox requires a premium subscription")
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { receiptInboxToken: true, email: true },
  })

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!user.receiptInboxToken) {
    const receiptInboxToken = generateToken()
    await prisma.user.update({
      where: { id: session.user.id },
      data: { receiptInboxToken },
    })
    return NextResponse.json({
      receiptInboxToken,
      receiptInboxAddress: `receipts+${receiptInboxToken}@parse.bitbudget.io`,
      email: user.email ?? null,
    })
  }

  return NextResponse.json({
    receiptInboxToken: user.receiptInboxToken,
    receiptInboxAddress: `receipts+${user.receiptInboxToken}@parse.bitbudget.io`,
    email: user.email ?? null,
  })
}

