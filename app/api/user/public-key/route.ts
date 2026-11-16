import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  isPublicKeyHex,
  verifyPublicKeyPossession,
} from "@/lib/public-key-possession"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { publicKey: true },
  })

  return NextResponse.json({ publicKey: user?.publicKey ?? null })
}

export async function PUT(req: Request) {
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
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const publicKey = record.publicKey
  const challengeToken = record.challengeToken
  const challenge = record.challenge

  if (!isPublicKeyHex(publicKey)) {
    return NextResponse.json({ error: "publicKey must be a 64-char hex string" }, { status: 400 })
  }
  if (typeof challengeToken !== "string" || typeof challenge !== "string") {
    return NextResponse.json(
      { error: "Proof of key possession is required", code: "PROOF_REQUIRED" },
      { status: 400 },
    )
  }
  if (
    !verifyPublicKeyPossession({
      publicKeyHex: publicKey,
      challengeToken,
      challenge,
    })
  ) {
    return NextResponse.json(
      { error: "Could not verify possession of this key", code: "PROOF_INVALID" },
      { status: 403 },
    )
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { publicKey },
  })

  return NextResponse.json({ success: true })
}
