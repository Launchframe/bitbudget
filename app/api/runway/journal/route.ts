import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  parseRunwayJournalCreate,
  parseRunwayJournalUpdate,
  validateEntryId,
  validateMonthKey,
} from "@/lib/runway-journal"

/**
 * Financial Runway journal entries. The server stores and returns ONLY
 * ciphertext in `encryptedBody` — it is never logged or decrypted here. Every
 * query is scoped to the session userId; the client is never trusted to scope.
 */

type JournalRow = {
  id: string
  monthKey: string
  envelopeId: string | null
  encryptedBody: string
  createdAt: Date
  updatedAt: Date
}

function serializeEntry(row: JournalRow) {
  return {
    id: row.id,
    monthKey: row.monthKey,
    envelopeId: row.envelopeId,
    encryptedBody: row.encryptedBody,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Confirm an envelope belongs to this user (null = no envelope requested). */
async function envelopeIsOwned(
  userId: string,
  envelopeId: string | null,
): Promise<boolean> {
  if (envelopeId == null) return true
  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId, userId },
    select: { id: true },
  })
  return envelope != null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 })
  }
  const userId = session.user.id

  const monthKeyParam = req.nextUrl.searchParams.get("monthKey")
  const where: { userId: string; monthKey?: string } = { userId }
  if (monthKeyParam !== null) {
    const monthKey = validateMonthKey(monthKeyParam)
    if (!monthKey.ok) {
      return NextResponse.json({ error: monthKey.error }, { status: 400 })
    }
    where.monthKey = monthKey.value
  }

  const rows = await prisma.runwayJournalEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(rows.map(serializeEntry))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 })
  }
  const userId = session.user.id

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that note." },
      { status: 400 },
    )
  }

  const parsed = parseRunwayJournalCreate(raw)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  if (!(await envelopeIsOwned(userId, parsed.value.envelopeId))) {
    return NextResponse.json(
      { error: "We couldn't find that envelope." },
      { status: 400 },
    )
  }

  const created = await prisma.runwayJournalEntry.create({
    data: {
      userId,
      monthKey: parsed.value.monthKey,
      envelopeId: parsed.value.envelopeId,
      encryptedBody: parsed.value.encryptedBody,
    },
  })

  return NextResponse.json(serializeEntry(created), { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 })
  }
  const userId = session.user.id

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that note." },
      { status: 400 },
    )
  }

  const parsed = parseRunwayJournalUpdate(raw)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const data: { encryptedBody: string; envelopeId?: string | null } = {
    encryptedBody: parsed.value.encryptedBody,
  }
  if ("envelopeId" in parsed.value) {
    const envelopeId = parsed.value.envelopeId ?? null
    if (!(await envelopeIsOwned(userId, envelopeId))) {
      return NextResponse.json(
        { error: "We couldn't find that envelope." },
        { status: 400 },
      )
    }
    data.envelopeId = envelopeId
  }

  // Scope the update to this user's own entry; updateMany returns a count so we
  // can distinguish "not yours / not found" without leaking existence.
  const result = await prisma.runwayJournalEntry.updateMany({
    where: { id: parsed.value.id, userId },
    data,
  })
  if (result.count === 0) {
    return NextResponse.json(
      { error: "We couldn't find that journal entry." },
      { status: 404 },
    )
  }

  const row = await prisma.runwayJournalEntry.findFirst({
    where: { id: parsed.value.id, userId },
  })
  if (!row) {
    return NextResponse.json(
      { error: "We couldn't find that journal entry." },
      { status: 404 },
    )
  }
  return NextResponse.json(serializeEntry(row))
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 })
  }
  const userId = session.user.id

  const id = validateEntryId(req.nextUrl.searchParams.get("id"))
  if (!id.ok) {
    return NextResponse.json({ error: id.error }, { status: 400 })
  }

  const result = await prisma.runwayJournalEntry.deleteMany({
    where: { id: id.value, userId },
  })
  if (result.count === 0) {
    return NextResponse.json(
      { error: "We couldn't find that journal entry." },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true })
}
