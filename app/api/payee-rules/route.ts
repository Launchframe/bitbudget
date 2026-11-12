import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { normalizePayeeKey } from "@/lib/payee-canonical"

const MAX_LEN = 200

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rows = await prisma.payeeDisplayAlias.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  })

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      sourceNormalized: r.sourceNormalized,
      canonicalPayee: r.canonicalPayee,
    })),
  )
}

export async function POST(req: NextRequest) {
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const sourceLabel = typeof (body as { sourceLabel?: unknown }).sourceLabel === "string"
    ? (body as { sourceLabel: string }).sourceLabel.trim()
    : ""
  const canonicalPayee = typeof (body as { canonicalPayee?: unknown }).canonicalPayee === "string"
    ? (body as { canonicalPayee: string }).canonicalPayee.trim()
    : ""

  if (!sourceLabel || !canonicalPayee) {
    return NextResponse.json(
      { error: "sourceLabel and canonicalPayee are required" },
      { status: 400 },
    )
  }
  if (sourceLabel.length > MAX_LEN || canonicalPayee.length > MAX_LEN) {
    return NextResponse.json({ error: "Field too long" }, { status: 400 })
  }

  const sourceNormalized = normalizePayeeKey(sourceLabel)
  if (sourceNormalized.length < 2) {
    return NextResponse.json({ error: "sourceLabel too short after normalization" }, { status: 400 })
  }

  const row = await prisma.payeeDisplayAlias.upsert({
    where: {
      userId_sourceNormalized: {
        userId: session.user.id,
        sourceNormalized,
      },
    },
    create: {
      userId: session.user.id,
      sourceNormalized,
      canonicalPayee,
    },
    update: {
      canonicalPayee,
    },
  })

  return NextResponse.json(
    {
      id: row.id,
      sourceNormalized: row.sourceNormalized,
      canonicalPayee: row.canonicalPayee,
    },
    { status: 201 },
  )
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  const result = await prisma.payeeDisplayAlias.deleteMany({
    where: { id, userId: session.user.id },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
