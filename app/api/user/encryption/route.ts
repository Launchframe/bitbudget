import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/** Matches `generateSalt()` in lib/crypto.ts (16 bytes → 32 hex chars). */
const PRIVACY_SALT_HEX_LEN = 32
const MAX_ENCRYPTED_PRIVACY_KEY_LEN = 512 * 1024

function isValidPrivacyKeySaltHex(s: string): boolean {
  if (s.length !== PRIVACY_SALT_HEX_LEN) return false
  return /^[0-9a-fA-F]+$/.test(s)
}

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
      { status: 409 },
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

  if (hasKey && (body.encryptedPrivacyKey === null || typeof body.encryptedPrivacyKey !== "string")) {
    return NextResponse.json(
      { error: "encryptedPrivacyKey, when provided, must be a non-null string." },
      { status: 400 },
    )
  }
  if (hasSalt && (body.privacyKeySalt === null || typeof body.privacyKeySalt !== "string")) {
    return NextResponse.json(
      { error: "privacyKeySalt, when provided, must be a non-null string." },
      { status: 400 },
    )
  }

  const isNostr = Boolean(existing.nostrPubkey)

  const keyStr =
    body.encryptedPrivacyKey === undefined || body.encryptedPrivacyKey === null
      ? ""
      : body.encryptedPrivacyKey.trim()
  const saltStr =
    body.privacyKeySalt === undefined || body.privacyKeySalt === null
      ? ""
      : body.privacyKeySalt.trim()

  if (keyStr.length > MAX_ENCRYPTED_PRIVACY_KEY_LEN) {
    return NextResponse.json(
      { error: `encryptedPrivacyKey exceeds maximum length (${MAX_ENCRYPTED_PRIVACY_KEY_LEN}).` },
      { status: 400 },
    )
  }
  if (saltStr.length > PRIVACY_SALT_HEX_LEN) {
    return NextResponse.json(
      { error: `privacyKeySalt must be at most ${PRIVACY_SALT_HEX_LEN} hex characters.` },
      { status: 400 },
    )
  }

  const emptyKeyWhere = {
    id: session.user.id,
    OR: [{ encryptedPrivacyKey: null }, { encryptedPrivacyKey: "" }],
  }

  if (isNostr) {
    if (!hasKey || keyStr.length === 0) {
      return NextResponse.json(
        { error: "encryptedPrivacyKey is required for Nostr accounts." },
        { status: 400 },
      )
    }
    if (hasSalt && saltStr.length === 0) {
      return NextResponse.json(
        { error: "privacyKeySalt cannot be empty when provided." },
        { status: 400 },
      )
    }
    if (hasSalt && saltStr.length > 0 && !isValidPrivacyKeySaltHex(saltStr)) {
      return NextResponse.json(
        {
          error: `privacyKeySalt must be exactly ${PRIVACY_SALT_HEX_LEN} hexadecimal characters (16-byte salt).`,
        },
        { status: 400 },
      )
    }
    const data = {
      encryptedPrivacyKey: keyStr,
      ...(hasSalt ? { privacyKeySalt: saltStr } : {}),
    }
    const result = await prisma.user.updateMany({
      where: emptyKeyWhere,
      data,
    })
    if (result.count === 0) {
      return NextResponse.json(
        {
          error:
            "Encryption is already configured for this account. You cannot replace it from onboarding. Use your existing passphrase on the main app, or contact support if you need a recovery flow.",
          code: "ENCRYPTION_ALREADY_CONFIGURED",
        },
        { status: 409 },
      )
    }
  } else {
    if (!hasKey || !hasSalt) {
      return NextResponse.json(
        { error: "Both encryptedPrivacyKey and privacyKeySalt are required for passphrase-based accounts." },
        { status: 400 },
      )
    }
    if (keyStr.length === 0 || saltStr.length === 0) {
      return NextResponse.json(
        { error: "encryptedPrivacyKey and privacyKeySalt must be non-empty strings." },
        { status: 400 },
      )
    }
    if (!isValidPrivacyKeySaltHex(saltStr)) {
      return NextResponse.json(
        {
          error: `privacyKeySalt must be exactly ${PRIVACY_SALT_HEX_LEN} hexadecimal characters (16-byte salt).`,
        },
        { status: 400 },
      )
    }
    const result = await prisma.user.updateMany({
      where: emptyKeyWhere,
      data: {
        encryptedPrivacyKey: keyStr,
        privacyKeySalt: saltStr,
      },
    })
    if (result.count === 0) {
      return NextResponse.json(
        {
          error:
            "Encryption is already configured for this account. You cannot replace it from onboarding. Use your existing passphrase on the main app, or contact support if you need a recovery flow.",
          code: "ENCRYPTION_ALREADY_CONFIGURED",
        },
        { status: 409 },
      )
    }
  }

  return NextResponse.json({ success: true })
}
