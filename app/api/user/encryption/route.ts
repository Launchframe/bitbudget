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
    select: { encryptedPrivacyKey: true, nostrPubkey: true },
  })

  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (existing.encryptedPrivacyKey && existing.encryptedPrivacyKey.length > 0) {
    return NextResponse.json(
      {
        error:
          "Encryption is already configured for this account. You cannot replace it from onboarding. Use your existing passphrase on the main app, or contact support if you need a recovery flow.",
        code: "ENCRYPTION_ALREADY_CONFIGURED",
      },
      { status: 409 }
    )
  }

  let body: { encryptedPrivacyKey?: string | null; privacyKeySalt?: string | null }
  try {
    body = (await req.json()) as { encryptedPrivacyKey?: string | null; privacyKeySalt?: string | null }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const hasKey = body.encryptedPrivacyKey !== undefined
  const hasSalt = body.privacyKeySalt !== undefined

  if (!hasKey && !hasSalt) {
    return NextResponse.json(
      { error: "Provide encryptedPrivacyKey (and privacyKeySalt for passphrase-based accounts)." },
      { status: 400 }
    )
  }

  const isNostr = Boolean(existing.nostrPubkey)

  const keyStr =
    body.encryptedPrivacyKey === undefined || body.encryptedPrivacyKey === null
      ? ""
      : String(body.encryptedPrivacyKey).trim()
  const saltStr =
    body.privacyKeySalt === undefined || body.privacyKeySalt === null
      ? ""
      : String(body.privacyKeySalt).trim()

  if (isNostr) {
    if (!hasKey || keyStr.length === 0) {
      return NextResponse.json(
        { error: "encryptedPrivacyKey is required for Nostr accounts." },
        { status: 400 }
      )
    }
    if (hasSalt && saltStr.length === 0) {
      return NextResponse.json(
        { error: "privacyKeySalt cannot be empty when provided." },
        { status: 400 }
      )
    }
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        encryptedPrivacyKey: keyStr,
        ...(hasSalt ? { privacyKeySalt: saltStr } : {}),
      },
    })
  } else {
    if (!hasKey || !hasSalt) {
      return NextResponse.json(
        { error: "Both encryptedPrivacyKey and privacyKeySalt are required for passphrase-based accounts." },
        { status: 400 }
      )
    }
    if (keyStr.length === 0 || saltStr.length === 0) {
      return NextResponse.json(
        { error: "encryptedPrivacyKey and privacyKeySalt must be non-empty strings." },
        { status: 400 }
      )
    }
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        encryptedPrivacyKey: keyStr,
        privacyKeySalt: saltStr,
      },
    })
  }

  return NextResponse.json({ success: true })
}
