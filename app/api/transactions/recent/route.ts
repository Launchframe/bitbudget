import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { transactionDateFromDb } from "@/lib/transaction-dates"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { lastVisitedAt: true },
  })

  if (!user?.lastVisitedAt) {
    return NextResponse.json([])
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: session.user.id,
      createdAt: { gt: user.lastVisitedAt },
      source: { not: "manual" },
    },
    orderBy: { createdAt: "desc" },
    include: { fundingBatch: { select: { periodKey: true, kind: true } } },
  })

  const formatted = transactions.map(t => ({
    id: t.id,
    date: transactionDateFromDb(t.date),
    payee: t.payee,
    amount: t.amount,
    type: t.type,
    envelopeId: t.envelopeId,
    tags: JSON.parse(t.tags),
    notes: t.notes ?? null,
    satsAmount: t.satsAmount ?? null,
    recurringId: t.recurringId ?? null,
    source: t.source,
    excludeFromMainHistory: t.excludeFromMainHistory,
    fundingBatchId: t.fundingBatchId,
    fundingBatchPeriodKey: t.fundingBatch?.periodKey ?? null,
    fundingBatchKind: t.fundingBatch?.kind ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }))

  return NextResponse.json(formatted)
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { lastVisitedAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
