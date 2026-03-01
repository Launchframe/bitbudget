import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const envelopeId = searchParams.get("envelopeId")
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")
  const type = searchParams.get("type")
  const search = searchParams.get("search")

  const where: Record<string, unknown> = { userId: session.user.id }
  if (envelopeId) where.envelopeId = envelopeId
  if (type && type !== "all") where.type = type
  if (startDate || endDate) {
    where.date = {
      ...(startDate ? { gte: new Date(startDate) } : {}),
      ...(endDate ? { lte: new Date(endDate + "T23:59:59") } : {}),
    }
  }
  if (search) {
    where.payee = { contains: search }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { date: "desc" },
  })

  const formatted = transactions.map(t => ({
    id: t.id,
    date: t.date.toISOString().split("T")[0],
    payee: t.payee,
    amount: t.amount,
    type: t.type,
    envelopeId: t.envelopeId,
    tags: JSON.parse(t.tags),
    recurringId: t.recurringId ?? null,
  }))

  return NextResponse.json(formatted)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { date, payee, amount, type, envelopeId, tags } = body

  if (!date || !payee || !amount || !type || !envelopeId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId, userId: session.user.id },
  })
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  const transaction = await prisma.transaction.create({
    data: {
      userId: session.user.id,
      envelopeId,
      date: new Date(date),
      payee,
      amount: Math.abs(amount),
      type,
      tags: JSON.stringify(tags || []),
    },
  })

  return NextResponse.json({
    id: transaction.id,
    date: transaction.date.toISOString().split("T")[0],
    payee: transaction.payee,
    amount: transaction.amount,
    type: transaction.type,
    envelopeId: transaction.envelopeId,
    tags: JSON.parse(transaction.tags),
    recurringId: transaction.recurringId ?? null,
  }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const id = searchParams.get("id")
  const all = searchParams.get("all")

  if (all === "true") {
    const { count } = await prisma.transaction.deleteMany({
      where: { userId: session.user.id },
    })
    return NextResponse.json({ deleted: count })
  }

  if (!id) {
    return NextResponse.json({ error: "Transaction ID required" }, { status: 400 })
  }

  const txn = await prisma.transaction.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!txn) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
  }

  await prisma.transaction.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
