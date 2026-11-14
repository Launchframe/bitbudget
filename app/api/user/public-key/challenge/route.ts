import { auth } from "@/lib/auth"
import {
  isPublicKeyHex,
  issuePublicKeyPossessionChallenge,
} from "@/lib/public-key-possession"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const publicKey =
    body && typeof body === "object" && "publicKey" in body
      ? (body as { publicKey: unknown }).publicKey
      : null
  if (!isPublicKeyHex(publicKey)) {
    return NextResponse.json({ error: "publicKey must be a 64-char hex string" }, { status: 400 })
  }

  try {
    const { challengeToken, sealedChallenge } = issuePublicKeyPossessionChallenge(publicKey)
    return NextResponse.json({ challengeToken, sealedChallenge })
  } catch {
    return NextResponse.json({ error: "Could not issue challenge" }, { status: 500 })
  }
}
