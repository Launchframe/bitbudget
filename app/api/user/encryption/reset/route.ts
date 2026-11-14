import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { auth } from "@/lib/auth"
import {
  ENCRYPTION_RESET_CONFIRM,
  authSessionCookieIsSecure,
  parseEncryptionResetMode,
} from "@/lib/encryption-reset"
import {
  encryptionResetRequiresReauth,
  resetUserEncryption,
} from "@/lib/encryption-reset-server"

/**
 * Destructive recovery: clear the wrapped privacy key so the client can set a new passphrase.
 * Requires a fresh sign-in (session age) plus typed confirmation — not an unattended cookie alone.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const secureCookie = authSessionCookieIsSecure({
    authUrl: process.env.AUTH_URL,
    nextAuthUrl: process.env.NEXTAUTH_URL,
    forwardedProto: req.headers.get("x-forwarded-proto"),
    requestProtocol: req.nextUrl.protocol,
  })
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie,
  })
  if (typeof token?.id === "string" && token.id !== session.user.id) {
    return NextResponse.json(
      {
        error:
          "For security, sign out and sign back in, then reset within 15 minutes. This confirms it is really you.",
        code: "REAUTH_REQUIRED",
      },
      { status: 403 },
    )
  }
  const nowSec = Math.floor(Date.now() / 1000)
  if (encryptionResetRequiresReauth(token?.iat, nowSec)) {
    return NextResponse.json(
      {
        error:
          "For security, sign out and sign back in, then reset within 15 minutes. This confirms it is really you.",
        code: "REAUTH_REQUIRED",
      },
      { status: 403 },
    )
  }

  let body: { mode?: unknown; confirm?: unknown }
  try {
    body = (await req.json()) as { mode?: unknown; confirm?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const mode = parseEncryptionResetMode(body.mode)
  if (!mode) {
    return NextResponse.json(
      { error: "Choose whether to clear encrypted transactions only, or clear all budgeting data." },
      { status: 400 },
    )
  }

  if (body.confirm !== ENCRYPTION_RESET_CONFIRM) {
    return NextResponse.json(
      { error: `Type ${ENCRYPTION_RESET_CONFIRM} to confirm you understand this cannot be undone.` },
      { status: 400 },
    )
  }

  try {
    const result = await resetUserEncryption({ userId: session.user.id, mode })
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      transactionsDeleted: result.transactionsDeleted,
      envelopesDeleted: result.envelopesDeleted,
    })
  } catch (err) {
    console.error("encryption reset failed", err)
    return NextResponse.json({ error: "Could not reset encryption. Try again." }, { status: 500 })
  }
}
