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
      name: true,
      email: true,
      subscriptionTier: true,
      role: true,
    },
  })

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json(user)
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const allowedFields = [
    "monthlyIncome",
    "payCadence",
    "onboardingComplete",
    "btcDisplayUnit",
    "opportunityCostEnabled",
    "encryptedPrivacyKey",
    "privacyKeySalt",
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
      name: true,
    },
  })

  return NextResponse.json(updated)
}
