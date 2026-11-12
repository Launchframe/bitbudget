import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  computeNostrProfileUpdates,
  needsNostrProfileSync,
  sanitizeNostrProfileImage,
  sanitizeNostrProfileName,
} from "@/lib/nostr-profile"

const userSelect = {
  nostrPubkey: true,
  name: true,
  image: true,
} as const

function profilePayload(user: {
  nostrPubkey: string | null
  name: string | null
  image: string | null
}) {
  return {
    nostrPubkey: user.nostrPubkey,
    name: user.name,
    image: user.image,
    needsSync: needsNostrProfileSync(user),
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: userSelect,
  })
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json(profilePayload(user))
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const profileName =
    typeof (body as { profileName?: unknown }).profileName === "string"
      ? (body as { profileName: string }).profileName
      : undefined
  const profileImage =
    typeof (body as { profileImage?: unknown }).profileImage === "string"
      ? (body as { profileImage: string }).profileImage
      : undefined

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: userSelect,
  })
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!user.nostrPubkey?.trim()) {
    return NextResponse.json({ error: "Account is not linked to Nostr" }, { status: 400 })
  }

  const updates = computeNostrProfileUpdates(user, {
    name: sanitizeNostrProfileName(profileName),
    image: sanitizeNostrProfileImage(profileImage),
  })

  if (!updates) {
    return NextResponse.json({
      updated: false,
      ...profilePayload(user),
    })
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: updates,
    select: userSelect,
  })

  return NextResponse.json({
    updated: true,
    ...profilePayload(updated),
  })
}
