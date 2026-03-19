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
    userId: session.user.id,
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

  const existing = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { encryptedPrivacyKey: true },
  })

  if (existing?.encryptedPrivacyKey && existing.encryptedPrivacyKey.length > 0) {
    return NextResponse.json(
      {
        error:
          "Encryption is already configured for this account. You cannot replace it from onboarding. Use your existing passphrase on the main app, or contact support if you need a recovery flow.",
        code: "ENCRYPTION_ALREADY_CONFIGURED",
      },
      { status: 409 }
    )
  }

  const body = (await req.json()) as {
    encryptedPrivacyKey?: string | null
    privacyKeySalt?: string | null
  }

  const data: { encryptedPrivacyKey?: string | null; privacyKeySalt?: string | null } = {}
  if (body.encryptedPrivacyKey !== undefined) data.encryptedPrivacyKey = body.encryptedPrivacyKey
  if (body.privacyKeySalt !== undefined) data.privacyKeySalt = body.privacyKeySalt

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  })

  return NextResponse.json({ success: true })
}
