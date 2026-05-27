import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import {
  parseTransactionDateInput,
  transactionCalendarDay,
  transactionDateFromDb,
} from "@/lib/transaction-dates"
import {
  parseTransactionQueryCalendarDate,
  utcEndOfCalendarDay,
} from "@/lib/transaction-query-dates"

function parseTagsJson(raw: string): string[] {
  try {
    const p = JSON.parse(raw) as unknown
    return Array.isArray(p) && p.every((x) => typeof x === "string") ? p : []
  } catch {
    return []
  }
}

function jsonTxnRow(t: {
  id: string
  date: Date
  payee: string
  amount: number
  type: string
  envelopeId: string
  tags: string
  notes: string | null
  satsAmount: number | null
  recurringId: string | null
  source: string
  excludeFromMainHistory: boolean
  fundingBatchId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: t.id,
    date: transactionDateFromDb(t.date),
    payee: t.payee,
    amount: t.amount,
    type: t.type,
    envelopeId: t.envelopeId,
    tags: parseTagsJson(t.tags),
    notes: t.notes ?? null,
    satsAmount: t.satsAmount ?? null,
    recurringId: t.recurringId ?? null,
    source: t.source,
    excludeFromMainHistory: t.excludeFromMainHistory,
    fundingBatchId: t.fundingBatchId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }
}

const TXN_TYPES = new Set(["expense", "credit"])

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
  // YYYY-MM-DD bounds in UTC so splits (recent vs older) match client `startDateForRecentWindow` / `dayBeforeIsoDate`.
  if (startDate || endDate) {
    const gte = startDate ? parseTransactionQueryCalendarDate(startDate) : null
    const lte = endDate ? utcEndOfCalendarDay(endDate) : null
    if (startDate && !gte) {
      return NextResponse.json({ error: "Invalid startDate (expected YYYY-MM-DD)" }, { status: 400 })
    }
    if (endDate && !lte) {
      return NextResponse.json({ error: "Invalid endDate (expected YYYY-MM-DD)" }, { status: 400 })
    }
    where.date = {
      ...(gte ? { gte } : {}),
      ...(lte ? { lte } : {}),
    }
  }

  const sinceParam = searchParams.get("since")
  if (sinceParam) {
    const sinceDate = new Date(sinceParam)
    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: "Invalid since parameter" }, { status: 400 })
    }
    // gte: include rows at the same ms as lastSync so we never miss concurrent updates; client upserts by id.
    where.updatedAt = { gte: sinceDate }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  })

  const formatted = transactions.map(jsonTxnRow)

  return NextResponse.json(formatted)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { date, payee, amount, type, envelopeId, tags, notes } = body

  if (!date || payee == null || amount == null || !type || !envelopeId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }
  if (typeof payee !== "string" || payee.trim().length === 0) {
    return NextResponse.json({ error: "Invalid payee" }, { status: 400 })
  }
  if (!TXN_TYPES.has(type)) {
    return NextResponse.json({ error: "type must be expense or credit" }, { status: 400 })
  }
  const amountNum = typeof amount === "number" ? amount : Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
  }
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags) || !tags.every((x) => typeof x === "string")) {
      return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 })
    }
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId, userId: session.user.id },
  })
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  const txnDate = parseTransactionDateInput(String(date))
  if (!txnDate) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  }
  const dateStr = transactionCalendarDay(String(date))
  const btcPrice = await getBtcPriceForDate(dateStr)
  const absAmount = Math.abs(amountNum)

  const transaction = await prisma.transaction.create({
    data: {
      userId: session.user.id,
      envelopeId,
      date: txnDate,
      payee: payee.trim(),
      amount: absAmount,
      type,
      tags: JSON.stringify(tags || []),
      notes: notes || null,
      satsAmount: btcPrice ? usdToSats(absAmount, btcPrice) : null,
    },
  })

  return NextResponse.json(jsonTxnRow(transaction), { status: 201 })
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

  if (envelopeId !== undefined) {
    if (typeof envelopeId !== "string" || envelopeId.trim() === "") {
      return NextResponse.json({ error: "Invalid envelopeId" }, { status: 400 })
    }
    if (envelopeId !== existing.envelopeId) {
      const envelope = await prisma.envelope.findFirst({
        where: { id: envelopeId, userId: session.user.id },
      })
      if (!envelope) {
        return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
      }
    }
  }

  if (date !== undefined && parseTransactionDateInput(String(date)) == null) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  }
  if (amount !== undefined) {
    const n = typeof amount === "number" ? amount : Number(amount)
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
    }
  }
  if (type !== undefined && !TXN_TYPES.has(type)) {
    return NextResponse.json({ error: "type must be expense or credit" }, { status: 400 })
  }
  if (payee !== undefined) {
    if (typeof payee !== "string" || payee.trim().length === 0) {
      return NextResponse.json({ error: "Invalid payee" }, { status: 400 })
    }
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || !tags.every((x) => typeof x === "string")) {
      return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 })
    }
  }

  const newDate =
    date !== undefined ? parseTransactionDateInput(String(date))! : existing.date
  const newAmount =
    amount !== undefined ? Math.abs(typeof amount === "number" ? amount : Number(amount)) : existing.amount

  let satsAmount: number | null = existing.satsAmount
  if (date !== undefined || amount !== undefined) {
    const dateStr = transactionCalendarDay(
      date !== undefined ? String(date) : transactionDateFromDb(existing.date),
    )
    const btcPrice = await getBtcPriceForDate(dateStr)
    satsAmount = btcPrice ? usdToSats(newAmount, btcPrice) : null
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      ...(date !== undefined && { date: newDate }),
      ...(payee !== undefined && { payee: payee.trim() }),
      ...(amount !== undefined && { amount: newAmount }),
      ...(type !== undefined && { type }),
      ...(envelopeId !== undefined && { envelopeId }),
      ...(tags !== undefined && { tags: JSON.stringify(tags) }),
      ...(notes !== undefined && { notes: notes || null }),
      satsAmount,
    },
  })

  return NextResponse.json(jsonTxnRow(updated))
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
