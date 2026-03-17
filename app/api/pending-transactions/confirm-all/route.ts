import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pendingList = await prisma.pendingTransaction.findMany({
    where: {
      userId: session.user.id,
      suggestedEnvelopeId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  })

  let confirmed = 0
  for (const pending of pendingList) {
    const envelopeId = pending.suggestedEnvelopeId!
    const envelope = await prisma.envelope.findFirst({
      where: { id: envelopeId, userId: session.user.id },
    })
    if (!envelope) continue

    const dateStr = pending.date.toISOString().split("T")[0]
    const btcPrice = await getBtcPriceForDate(dateStr)
    const absAmount = Math.abs(pending.amount)

    await prisma.transaction.create({
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

    await prisma.pendingTransaction.delete({ where: { id: pending.id } })
    confirmed++
  }

  return NextResponse.json({ confirmed })
}
