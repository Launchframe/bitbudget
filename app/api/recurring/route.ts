import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { advanceDate } from "@/lib/recurring"
import type { Cadence } from "@/lib/recurring"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

const VALID_CADENCES = ["weekly", "biweekly", "monthly", "quarterly", "annual"]

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const recurrings = await prisma.recurringTransaction.findMany({
    where: { userId: session.user.id },
    orderBy: { nextDueDate: "asc" },
    include: { envelope: { select: { name: true, color: true } } },
  })

  const formatted = recurrings.map((r) => ({
    id: r.id,
    payee: r.payee,
    amount: r.amount,
    type: r.type,
    envelopeId: r.envelopeId,
    envelopeName: r.envelope.name,
    envelopeColor: r.envelope.color,
    cadence: r.cadence,
    tags: JSON.parse(r.tags),
    nextDueDate: r.nextDueDate.toISOString().split("T")[0],
    endDate: r.endDate?.toISOString().split("T")[0] ?? null,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
  }))

  return NextResponse.json(formatted)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { payee, amount, type, envelopeId, cadence, startDate, endDate, tags } = body

  if (!payee || !amount || !type || !envelopeId || !cadence || !startDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  if (!VALID_CADENCES.includes(cadence)) {
    return NextResponse.json({ error: "Invalid cadence" }, { status: 400 })
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId, userId: session.user.id },
  })
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  const userId = session.user.id
  const absAmount = Math.abs(amount)
  const firstDate = new Date(startDate)
  const nextDue = advanceDate(firstDate, cadence as Cadence)
  const dateStr = firstDate.toISOString().split("T")[0]
  const btcPrice = await getBtcPriceForDate(dateStr)

  const [recurring, transaction] = await prisma.$transaction(async (tx) => {
    const rec = await tx.recurringTransaction.create({
      data: {
        userId,
        envelopeId,
        payee,
        amount: absAmount,
        type,
        tags: JSON.stringify(tags || []),
        cadence,
        nextDueDate: nextDue,
        endDate: endDate ? new Date(endDate) : null,
      },
    })

    const txn = await tx.transaction.create({
      data: {
        userId,
        envelopeId,
        date: firstDate,
        payee,
        amount: absAmount,
        type,
        tags: JSON.stringify(tags || []),
        recurringId: rec.id,
        satsAmount: btcPrice ? usdToSats(absAmount, btcPrice) : null,
      },
    })

    return [rec, txn]
  })

  return NextResponse.json({
    recurring: {
      id: recurring.id,
      cadence: recurring.cadence,
      nextDueDate: recurring.nextDueDate.toISOString().split("T")[0],
      active: recurring.active,
    },
    transaction: {
      id: transaction.id,
      date: transaction.date.toISOString().split("T")[0],
      payee: transaction.payee,
      amount: transaction.amount,
      type: transaction.type,
      envelopeId: transaction.envelopeId,
      tags: JSON.parse(transaction.tags),
      notes: transaction.notes ?? null,
      satsAmount: transaction.satsAmount ?? null,
      recurringId: transaction.recurringId,
    },
  }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "Recurring transaction ID required" }, { status: 400 })
  }

  const rec = await prisma.recurringTransaction.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!rec) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.recurringTransaction.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
