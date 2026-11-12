import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { recordPayeeMapping } from "@/lib/envelope-matcher"

const MAX_MAPPINGS = 200

interface MappingEntry {
  payee: string
  envelopeId: string
}

function isValidEntry(v: unknown): v is MappingEntry {
  if (typeof v !== "object" || v === null) return false
  const e = v as MappingEntry
  return typeof e.payee === "string" && e.payee.trim().length > 0 && typeof e.envelopeId === "string" && e.envelopeId.trim().length > 0
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

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const { mappings } = body as { mappings?: unknown }

  if (!Array.isArray(mappings) || mappings.length === 0) {
    return NextResponse.json({ error: "mappings array required" }, { status: 400 })
  }
  if (mappings.length > MAX_MAPPINGS) {
    return NextResponse.json({ error: `Too many mappings (max ${MAX_MAPPINGS})` }, { status: 400 })
  }
  if (!mappings.every(isValidEntry)) {
    return NextResponse.json({ error: "Each mapping must have payee and envelopeId" }, { status: 400 })
  }

  const userId = session.user.id
  const envelopeIds = [...new Set((mappings as MappingEntry[]).map((m) => m.envelopeId))]
  const owned = await prisma.envelope.findMany({
    where: { userId, id: { in: envelopeIds }, archived: false },
    select: { id: true },
  })
  const ownedIds = new Set(owned.map((e) => e.id))
  if (envelopeIds.some((id) => !ownedIds.has(id))) {
    return NextResponse.json({ error: "Invalid envelopeId in mappings" }, { status: 400 })
  }

  await Promise.all(
    (mappings as MappingEntry[]).map(({ payee, envelopeId }) =>
      recordPayeeMapping(userId, payee, envelopeId),
    ),
  )

  return NextResponse.json({ ok: true, recorded: mappings.length })
}
