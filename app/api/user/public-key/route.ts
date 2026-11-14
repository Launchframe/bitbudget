import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
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

  let publicKey: unknown
  try {
    const body = (await req.json()) as { publicKey?: unknown }
    publicKey = body.publicKey
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!publicKey || typeof publicKey !== "string") {
    return NextResponse.json({ error: "publicKey is required" }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { encryptedPrivacyKey: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }
  // A stale tab must not republish the old public key after reset nulled the wrap.
  if (!existing.encryptedPrivacyKey) {
    return NextResponse.json(
      {
        error: "Set up a passphrase before saving an encryption key.",
        code: "ENCRYPTION_NOT_CONFIGURED",
      },
      { status: 409 },
    )
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { publicKey },
  })

  return NextResponse.json({ success: true })
}
