import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { id, envelopeId: bodyEnvelopeId } = body

  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 })
  }

  const pending = await prisma.pendingTransaction.findFirst({
    where: { id, userId: session.user.id },
  })

  if (!pending) {
    return NextResponse.json({ error: "Pending transaction not found" }, { status: 404 })
  }

  const envelopeId = bodyEnvelopeId ?? pending.suggestedEnvelopeId
  if (!envelopeId) {
    return NextResponse.json({ error: "Envelope is required" }, { status: 400 })
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId, userId: session.user.id },
  })
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  const dateStr = pending.date.toISOString().split("T")[0]
  const btcPrice = await getBtcPriceForDate(dateStr)
  const absAmount = Math.abs(pending.amount)

  const transaction = await prisma.transaction.create({
    data: {
      userId: session.user.id,
      envelopeId,
      date: pending.date,
      payee: pending.payee,
      amount: absAmount,
      type: "expense",
      source: pending.source,
      tags: pending.tags ?? "[]",
      notes: pending.notes ?? null,
      satsAmount: btcPrice ? usdToSats(absAmount, btcPrice) : null,
    },
  })

  await prisma.pendingTransaction.delete({ where: { id } })

  return NextResponse.json(
    {
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
    },
    { status: 201 },
  )
}
