import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { advanceDate } from "@/lib/recurring"
import type { Cadence } from "@/lib/recurring"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

/**
 * POST /api/recurring/post-now
 *
 * Records an early (manual) posting of an upcoming recurring transaction.
 * Atomically creates the transaction record and advances the rule's nextDueDate
 * by one cadence period, effectively skipping the scheduled auto-occurrence.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const body = await req.json()
  const { recurringId, payee, amount, type, envelopeId, tags, notes, date } = body

  if (!recurringId || !payee || amount == null || !type || !envelopeId || !date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const rec = await prisma.recurringTransaction.findFirst({
    where: { id: recurringId, userId, active: true },
  })
  if (!rec) {
    return NextResponse.json({ error: "Recurring rule not found" }, { status: 404 })
  }

  const txnDate = new Date(date)
  const dateStr = txnDate.toISOString().split("T")[0]
  const btcPrice = await getBtcPriceForDate(dateStr)
  const absAmount = Math.abs(amount)

  // Advance nextDueDate from its current scheduled value (not from today),
  // so the skip lands on the correct future occurrence.
  const nextDue = advanceDate(rec.nextDueDate, rec.cadence as Cadence)

  const [transaction] = await prisma.$transaction(async (tx) => {
    const txn = await tx.transaction.create({
      data: {
        userId,
        envelopeId,
        date: txnDate,
        payee,
        amount: absAmount,
        type,
        tags: JSON.stringify(tags ?? []),
        notes: notes ?? null,
        recurringId,
        satsAmount: btcPrice ? usdToSats(absAmount, btcPrice) : null,
        source: "manual",
      },
    })

    await tx.recurringTransaction.update({
      where: { id: recurringId },
      data: { nextDueDate: nextDue },
    })

    return [txn]
  })

  return NextResponse.json(
    {
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
      nextDueDate: nextDue.toISOString().split("T")[0],
    },
    { status: 201 },
  )
}
