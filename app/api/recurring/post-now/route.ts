import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { advanceDate } from "@/lib/recurring"
import type { Cadence } from "@/lib/recurring"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import {
  assertTagStringArray,
  isPositiveFiniteAmount,
  parseCalendarDateString,
  RECURRING_TXN_TYPES,
} from "@/lib/recurring-field-validation"

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

  if (typeof recurringId !== "string" || recurringId.trim() === "") {
    return NextResponse.json({ error: "Invalid recurringId" }, { status: 400 })
  }
  const normalizedRecurringId = recurringId.trim()
  if (typeof envelopeId !== "string" || envelopeId.trim() === "") {
    return NextResponse.json({ error: "Invalid envelopeId" }, { status: 400 })
  }
  const normalizedEnvelopeId = envelopeId.trim()
  if (typeof payee !== "string") {
    return NextResponse.json({ error: "Invalid payee" }, { status: 400 })
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 })
  }
  if (!RECURRING_TXN_TYPES.has(type)) {
    return NextResponse.json({ error: "type must be expense or credit" }, { status: 400 })
  }
  if (!isPositiveFiniteAmount(amount)) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
  }
  const amountNum = typeof amount === "number" ? amount : Number(amount)
  if (tags !== undefined && tags !== null && !assertTagStringArray(tags)) {
    return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 })
  }

  const txnDate = parseCalendarDateString(typeof date === "string" ? date : String(date))
  if (!txnDate) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: normalizedEnvelopeId, userId },
  })
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  const rec = await prisma.recurringTransaction.findFirst({
    where: { id: normalizedRecurringId, userId, active: true },
  })
  if (!rec) {
    return NextResponse.json({ error: "Recurring rule not found" }, { status: 404 })
  }

  const dateStr = txnDate.toISOString().split("T")[0]
  const btcPrice = await getBtcPriceForDate(dateStr)
  const absAmount = Math.abs(amountNum)

  // Advance nextDueDate from its current scheduled value (not from today),
  // so the skip lands on the correct future occurrence.
  const nextDue = advanceDate(rec.nextDueDate, rec.cadence as Cadence)

  const [transaction] = await prisma.$transaction(async (tx) => {
    const txn = await tx.transaction.create({
      data: {
        userId,
        envelopeId: normalizedEnvelopeId,
        date: txnDate,
        payee,
        amount: absAmount,
        type,
        tags: JSON.stringify(tags ?? []),
        notes: notes ?? null,
        recurringId: normalizedRecurringId,
        satsAmount: btcPrice ? usdToSats(absAmount, btcPrice) : null,
        source: "manual",
      },
    })

    await tx.recurringTransaction.update({
      where: { id: normalizedRecurringId },
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
