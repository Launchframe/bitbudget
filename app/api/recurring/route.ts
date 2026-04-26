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
    notes: r.notes ?? null,
  }))

  return NextResponse.json(formatted)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { payee, amount, type, envelopeId, cadence, startDate, endDate, tags, notes } = body

  if (!payee || !amount || !type || !envelopeId || !cadence || !startDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  if (typeof payee !== "string" || payee.trim() === "") {
    return NextResponse.json({ error: "Invalid payee" }, { status: 400 })
  }
  if (!isPositiveFiniteAmount(amount)) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
  }
  if (!RECURRING_TXN_TYPES.has(type)) {
    return NextResponse.json({ error: "type must be expense or credit" }, { status: 400 })
  }
  if (typeof envelopeId !== "string" || envelopeId.trim() === "") {
    return NextResponse.json({ error: "Invalid envelopeId" }, { status: 400 })
  }
  if (!VALID_CADENCES.includes(cadence)) {
    return NextResponse.json({ error: "Invalid cadence" }, { status: 400 })
  }
  const firstDate = parseCalendarDateString(startDate)
  if (!firstDate) {
    return NextResponse.json({ error: "Invalid startDate" }, { status: 400 })
  }
  const parsedEndDate = endDate ? parseCalendarDateString(endDate) : null
  if (endDate && !parsedEndDate) {
    return NextResponse.json({ error: "Invalid endDate" }, { status: 400 })
  }
  if (tags !== undefined && tags !== null && !assertTagStringArray(tags)) {
    return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 })
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 })
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId.trim(), userId: session.user.id },
  })
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  const userId = session.user.id
  const absAmount = Math.abs(typeof amount === "number" ? amount : Number(amount))
  const nextDue = advanceDate(firstDate, cadence as Cadence)
  const dateStr = firstDate.toISOString().split("T")[0]
  const btcPrice = await getBtcPriceForDate(dateStr)
  const normalizedPayee = payee.trim()
  const normalizedEnvelopeId = envelopeId.trim()

  const [recurring, transaction] = await prisma.$transaction(async (tx) => {
    const rec = await tx.recurringTransaction.create({
      data: {
        userId,
        envelopeId: normalizedEnvelopeId,
        payee: normalizedPayee,
        amount: absAmount,
        type,
        tags: JSON.stringify(tags || []),
        notes: notes || null,
        cadence,
        nextDueDate: nextDue,
        endDate: parsedEndDate,
      },
    })

    const txn = await tx.transaction.create({
      data: {
        userId,
        envelopeId: normalizedEnvelopeId,
        date: firstDate,
        payee: normalizedPayee,
        amount: absAmount,
        type,
        tags: JSON.stringify(tags || []),
        notes: notes || null,
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

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { id, payee, amount, type, envelopeId, cadence, endDate, tags, notes } = body

  if (typeof id !== "string" || id.trim().length === 0) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }
  const normalizedId = id.trim()
  if (cadence !== undefined && !VALID_CADENCES.includes(cadence)) {
    return NextResponse.json({ error: "Invalid cadence" }, { status: 400 })
  }

  const rec = await prisma.recurringTransaction.findFirst({
    where: { id: normalizedId, userId: session.user.id },
  })
  if (!rec) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (envelopeId !== undefined) {
    if (typeof envelopeId !== "string" || envelopeId.trim() === "") {
      return NextResponse.json({ error: "Invalid envelopeId" }, { status: 400 })
    }
    const envelope = await prisma.envelope.findFirst({
      where: { id: envelopeId.trim(), userId: session.user.id },
    })
    if (!envelope) {
      return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
    }
  }

  if (amount !== undefined && !isPositiveFiniteAmount(amount)) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
  }
  if (type !== undefined && !RECURRING_TXN_TYPES.has(type)) {
    return NextResponse.json({ error: "type must be expense or credit" }, { status: 400 })
  }
  if (payee !== undefined && (typeof payee !== "string" || payee.trim() === "")) {
    return NextResponse.json({ error: "Invalid payee" }, { status: 400 })
  }
  if (endDate !== undefined && endDate !== null) {
    if (typeof endDate !== "string") {
      return NextResponse.json({ error: "Invalid endDate" }, { status: 400 })
    }
    if (!parseCalendarDateString(endDate)) {
      return NextResponse.json({ error: "Invalid endDate" }, { status: 400 })
    }
  }
  if (tags !== undefined && !assertTagStringArray(tags)) {
    return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 })
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 })
  }

  const resolvedAmount =
    amount !== undefined ? Math.abs(typeof amount === "number" ? amount : Number(amount)) : undefined
  const normalizedEnvelopeId = typeof envelopeId === "string" ? envelopeId.trim() : undefined
  const normalizedEndDate =
    endDate !== undefined && endDate !== null ? parseCalendarDateString(endDate) : null

  const updated = await prisma.recurringTransaction.update({
    where: { id: normalizedId },
    data: {
      ...(payee !== undefined && { payee: payee.trim() }),
      ...(resolvedAmount !== undefined && { amount: resolvedAmount }),
      ...(type !== undefined && { type }),
      ...(normalizedEnvelopeId !== undefined && { envelopeId: normalizedEnvelopeId }),
      ...(cadence !== undefined && { cadence }),
      ...(endDate !== undefined && { endDate: normalizedEndDate }),
      ...(tags !== undefined && { tags: JSON.stringify(tags) }),
      ...(notes !== undefined && { notes: notes ?? null }),
    },
    include: { envelope: { select: { name: true, color: true } } },
  })

  return NextResponse.json({
    id: updated.id,
    payee: updated.payee,
    amount: updated.amount,
    type: updated.type,
    envelopeId: updated.envelopeId,
    envelopeName: updated.envelope.name,
    envelopeColor: updated.envelope.color,
    cadence: updated.cadence,
    tags: JSON.parse(updated.tags),
    nextDueDate: updated.nextDueDate.toISOString().split("T")[0],
    endDate: updated.endDate?.toISOString().split("T")[0] ?? null,
    active: updated.active,
    createdAt: updated.createdAt.toISOString(),
    notes: updated.notes ?? null,
  })
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
