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
    select: { encryptedPrivacyKey: true, privacyKeySalt: true, nostrPubkey: true },
  })

  return NextResponse.json({
    encryptedPrivacyKey: user?.encryptedPrivacyKey ?? null,
    privacyKeySalt: user?.privacyKeySalt ?? null,
    isNostr: !!user?.nostrPubkey,
    nostrPubkey: user?.nostrPubkey ?? null,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { encryptedPrivacyKey, privacyKeySalt } = await req.json()

  await prisma.user.update({
    where: { id: session.user.id },
    data: { encryptedPrivacyKey, privacyKeySalt },
  })

  return NextResponse.json({ success: true })
}
