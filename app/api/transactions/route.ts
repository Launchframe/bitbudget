import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

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

  const where: Record<string, unknown> = { userId: session.user.id }
  if (envelopeId) where.envelopeId = envelopeId
  if (type && type !== "all") where.type = type
  if (startDate || endDate) {
    where.date = {
      ...(startDate ? { gte: new Date(startDate) } : {}),
      ...(endDate ? { lte: new Date(endDate + "T23:59:59") } : {}),
    }
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
    notes: t.notes ?? null,
    satsAmount: t.satsAmount ?? null,
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
  const { date, payee, amount, type, envelopeId, tags, notes } = body

  if (!date || !payee || !amount || !type || !envelopeId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId, userId: session.user.id },
  })
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  const txnDate = new Date(date)
  const dateStr = txnDate.toISOString().split("T")[0]
  const btcPrice = await getBtcPriceForDate(dateStr)
  const absAmount = Math.abs(amount)

  const transaction = await prisma.transaction.create({
    data: {
      userId: session.user.id,
      envelopeId,
      date: txnDate,
      payee,
      amount: absAmount,
      type,
      tags: JSON.stringify(tags || []),
      notes: notes || null,
      satsAmount: btcPrice ? usdToSats(absAmount, btcPrice) : null,
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
    notes: transaction.notes ?? null,
    satsAmount: transaction.satsAmount ?? null,
    recurringId: transaction.recurringId ?? null,
  }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { id, date, payee, amount, type, envelopeId, tags, notes } = body

  if (!id) {
    return NextResponse.json({ error: "Transaction ID required" }, { status: 400 })
  }

  const existing = await prisma.transaction.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
  }

  if (envelopeId && envelopeId !== existing.envelopeId) {
    const envelope = await prisma.envelope.findFirst({
      where: { id: envelopeId, userId: session.user.id },
    })
    if (!envelope) {
      return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
    }
  }

  const newDate = date !== undefined ? new Date(date) : existing.date
  const newAmount = amount !== undefined ? Math.abs(amount) : existing.amount

  let satsAmount: number | null = existing.satsAmount
  if (date !== undefined || amount !== undefined) {
    const dateStr = newDate.toISOString().split("T")[0]
    const btcPrice = await getBtcPriceForDate(dateStr)
    satsAmount = btcPrice ? usdToSats(newAmount, btcPrice) : null
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      ...(date !== undefined && { date: newDate }),
      ...(payee !== undefined && { payee }),
      ...(amount !== undefined && { amount: newAmount }),
      ...(type !== undefined && { type }),
      ...(envelopeId !== undefined && { envelopeId }),
      ...(tags !== undefined && { tags: JSON.stringify(tags) }),
      ...(notes !== undefined && { notes: notes || null }),
      satsAmount,
    },
  })

  return NextResponse.json({
    id: updated.id,
    date: updated.date.toISOString().split("T")[0],
    payee: updated.payee,
    amount: updated.amount,
    type: updated.type,
    envelopeId: updated.envelopeId,
    tags: JSON.parse(updated.tags),
    notes: updated.notes ?? null,
    satsAmount: updated.satsAmount ?? null,
    recurringId: updated.recurringId ?? null,
  })
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
