import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

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
      _count: { select: { transactions: true } },
    },
  })

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { _count, ...rest } = user
  return NextResponse.json({
    ...rest,
    transactionCount: _count.transactions,
  })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  // Never allow encryptedPrivacyKey / privacyKeySalt via this route — use POST /api/user/encryption
  // (guarded) so existing keys cannot be clobbered by mistake or a buggy client.
  const allowedFields = [
    "monthlyIncome",
    "payCadence",
    "onboardingComplete",
    "btcDisplayUnit",
    "opportunityCostEnabled",
    "receiptInboxToken",
    "name",
  ] as const

  const data: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      data[field] = body[field]
    }
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
