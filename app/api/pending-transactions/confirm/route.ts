import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate } from "@/lib/btc-price"
import { confirmPendingTransactionAtomic } from "@/lib/pending-transaction-confirm"
import { recordPayeeMapping } from "@/lib/envelope-matcher"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { id, envelopeId: bodyEnvelopeId, payee, amount, date, notes, tags, payeePlain } = body

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

  const parsedDate =
    typeof date === "string" && date.trim() ? new Date(date) : undefined
  if (parsedDate !== undefined && Number.isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  }

  // Fetch BTC price before opening the transaction so we don't hold a DB
  // connection open during a cache lookup or HTTP fallback.
  const effectiveDate = parsedDate ?? pending.date
  const btcPrice = await getBtcPriceForDate(effectiveDate.toISOString().split("T")[0]!)

  const transaction = await confirmPendingTransactionAtomic(
    session.user.id,
    id,
    envelopeId,
    {
      payee: typeof payee === "string" ? payee : undefined,
      amount: typeof amount === "number" ? amount : undefined,
      date: parsedDate,
      notes: notes === null ? null : typeof notes === "string" ? notes : undefined,
      tags:
        Array.isArray(tags) && tags.every((tag: unknown) => typeof tag === "string")
          ? tags
          : undefined,
      btcPrice,
    },
  )

  if (!transaction) {
    return NextResponse.json(
      { error: "Pending transaction not found or already confirmed" },
      { status: 409 },
    )
  }

  const mappingPayee =
    typeof payeePlain === "string" && payeePlain.trim() ? payeePlain.trim() : null
  if (mappingPayee) {
    await recordPayeeMapping(session.user.id, mappingPayee, envelopeId)
  }

  return NextResponse.json(transaction, { status: 201 })
}
