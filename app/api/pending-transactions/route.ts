import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pending = await prisma.pendingTransaction.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  })

  const formatted = pending.map(p => ({
    id: p.id,
    source: p.source,
    payee: p.payee,
    amount: p.amount,
    date: p.date.toISOString().split("T")[0],
    notes: p.notes ?? null,
    suggestedEnvelopeId: p.suggestedEnvelopeId ?? null,
    confidence: p.confidence,
    rawInput: p.rawInput ?? null,
    tags: p.tags ?? null,
    createdAt: p.createdAt.toISOString(),
  }))

  return NextResponse.json(formatted)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 })
  }

  const pending = await prisma.pendingTransaction.findFirst({
    where: { id, userId: session.user.id },
  })

  if (!pending) {
    return NextResponse.json({ error: "Pending transaction not found" }, { status: 404 })
  }

  await prisma.pendingTransaction.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
