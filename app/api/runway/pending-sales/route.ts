import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  parsePendingSaleCreateBody,
  parsePendingSaleUpdateBody,
} from "@/lib/pending-sale"

/** Shape of a pending-sale row selected from the DB. */
interface PendingSaleRow {
  id: string
  status: string
  sats: bigint
  markPriceUsd: Prisma.Decimal
  proceedsUsd: Prisma.Decimal | null
  linkedTransactionId: string | null
  createdAt: Date
  updatedAt: Date
}

/** JSON-safe representation (Decimal → number, BigInt → number). */
function serializeSale(row: PendingSaleRow) {
  return {
    id: row.id,
    status: row.status,
    sats: Number(row.sats),
    markPriceUsd: Number(row.markPriceUsd),
    proceedsUsd: row.proceedsUsd == null ? null : Number(row.proceedsUsd),
    linkedTransactionId: row.linkedTransactionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const rows = (await prisma.pendingBtcSale.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  })) as PendingSaleRow[]

  return NextResponse.json({ sales: rows.map(serializeSale) })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = parsePendingSaleCreateBody(raw)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const v = parsed.value

  const created = (await prisma.pendingBtcSale.create({
    data: {
      userId,
      status: "sent",
      sats: BigInt(v.sats),
      markPriceUsd: new Prisma.Decimal(v.markPriceUsd),
    },
  })) as PendingSaleRow

  return NextResponse.json({ sale: serializeSale(created) }, { status: 201 })
}

function resolveSaleId(req: NextRequest, body: unknown): string | null {
  const queryId = req.nextUrl.searchParams.get("id")
  if (queryId != null && queryId.trim() !== "") return queryId.trim()
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).id === "string"
  ) {
    const bodyId = (body as Record<string, string>).id.trim()
    if (bodyId !== "") return bodyId
  }
  return null
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const id = resolveSaleId(req, raw)
  if (!id) {
    return NextResponse.json({ error: "Sale id is required" }, { status: 400 })
  }

  const parsed = parsePendingSaleUpdateBody(raw)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const existing = (await prisma.pendingBtcSale.findFirst({
    where: { id, userId },
  })) as PendingSaleRow | null
  if (!existing) {
    return NextResponse.json({ error: "Sale not found" }, { status: 404 })
  }

  const u = parsed.value
  const data: Prisma.PendingBtcSaleUpdateInput = {}
  if (u.status !== undefined) data.status = u.status
  if (u.proceedsUsd !== undefined) {
    data.proceedsUsd =
      u.proceedsUsd == null ? null : new Prisma.Decimal(u.proceedsUsd)
  }
  if (u.linkedTransactionId !== undefined) {
    data.linkedTransactionId = u.linkedTransactionId
  }

  const updated = (await prisma.pendingBtcSale.update({
    where: { id: existing.id },
    data,
  })) as PendingSaleRow

  return NextResponse.json({ sale: serializeSale(updated) })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const id = req.nextUrl.searchParams.get("id")?.trim()
  if (!id) {
    return NextResponse.json({ error: "Sale id is required" }, { status: 400 })
  }

  const result = await prisma.pendingBtcSale.deleteMany({ where: { id, userId } })
  if (result.count === 0) {
    return NextResponse.json({ error: "Sale not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true, deletedId: id })
}
